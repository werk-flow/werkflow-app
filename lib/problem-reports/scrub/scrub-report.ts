import 'server-only';

import { logError } from '@/lib/logging';
import {
  parseStoredProblemReportContext,
  type ScrubbedProblemReportContext,
} from '@/lib/problem-reports/schemas';
import { loadUiStringCatalog } from '@/lib/problem-reports/screenshot/load-ui-string-catalog';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { SCRUB_RULES_VERSION } from './rule-version';
import { buildScrubDictionary, dictionaryKnows, type ScrubDictionarySources } from './dictionary';
import { holdsIdentifier, scrubReportContext, scrubReportText } from './scrub-text';

// The scrubbed copy of a stored problem report
// (docs/technical/problem-report-scrubbing.md, "Text scrubbing"). Scrubbing
// fails closed: a dictionary that cannot be read, or a scrub that throws,
// leaves no copy and the state `nicht_bereinigbar`; the report itself stays.
// The dictionary is read for one scrub and never kept. Logs carry codes
// only, never a report's text or a name.

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** Above this many rows of one kind the dictionary would be incomplete, so the scrub fails. */
const DICTIONARY_ROW_CAP = 100_000;
const PENDING_PAGE_SIZE = 100;

const present = (values: ReadonlyArray<string | null>): string[] =>
  values.filter((value): value is string => value !== null && value.trim() !== '');
const joined = (separator: string, ...parts: Array<string | null>): string => present(parts).join(separator);

/** The organization itself and its rows that name a person, a customer, an address or a phone number. */
async function readDictionaryRows(admin: Admin, organizationId: string) {
  const [organization, clients, contacts, sites, requests, employees, members] = await Promise.all([
    admin.from('organizations').select('name, unique_code').eq('id', organizationId).maybeSingle(),
    readCompleteRows(
      (from, to) =>
        admin
          .from('clients')
          .select('name, address, phone')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      DICTIONARY_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('client_contacts')
          .select('name, phone')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      DICTIONARY_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('client_sites')
          .select('name, street, postal_code, city')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      DICTIONARY_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('client_requests')
          .select('caller_name, caller_address, caller_phone')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      DICTIONARY_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_records')
          .select(
            'first_name, last_name, street, postal_code, city, phone, emergency_contact_name, emergency_contact_phone',
          )
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      DICTIONARY_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      DICTIONARY_ROW_CAP,
    ),
  ]);
  const profiles = await readInBatches(
    members.data.map((member) => member.user_id),
    (ids) => admin.from('profiles').select('first_name, last_name').in('id', ids),
  );
  return { organization, clients, contacts, sites, requests, employees, members, profiles };
}

/** What the organization's own rows know as names, addresses and phone numbers; null when a read fails. */
async function readDictionarySources(
  admin: Admin,
  organizationId: string,
): Promise<ScrubDictionarySources | null> {
  const reads = await readDictionaryRows(admin, organizationId);
  const failed = Object.values(reads).find((read) => read.error !== null);
  if (failed) {
    logError('scrubStoredProblemReport: dictionary read failed', failed.error);
    return null;
  }
  const [clients, contacts, sites] = [reads.clients.data, reads.contacts.data, reads.sites.data];
  const [requests, employees, profiles] = [reads.requests.data, reads.employees.data, reads.profiles.data];
  return {
    // The organization's own name is a company name like a customer's.
    customerNames: present([
      reads.organization.data?.name ?? null,
      ...clients.map((client) => client.name),
      ...requests.map((request) => request.caller_name),
    ]),
    personNames: present([
      ...contacts.map((contact) => contact.name),
      ...employees.flatMap((employee) => [
        joined(' ', employee.first_name, employee.last_name),
        employee.emergency_contact_name,
      ]),
      ...profiles.map((profile) => joined(' ', profile.first_name, profile.last_name)),
    ]),
    siteNames: present(sites.map((site) => site.name)),
    addresses: present([
      ...clients.map((client) => client.address),
      ...requests.map((request) => request.caller_address),
      ...[...sites, ...employees].map((row) =>
        joined(', ', row.street, joined(' ', row.postal_code, row.city)),
      ),
    ]),
    phones: present([
      ...clients.map((client) => client.phone),
      ...contacts.map((contact) => contact.phone),
      ...requests.map((request) => request.caller_phone),
      ...employees.flatMap((employee) => [employee.phone, employee.emergency_contact_phone]),
    ]),
    identifiers: present([reads.organization.data?.unique_code ?? null]),
  };
}

/** The scrubbed copy of one report's originals, or null when it cannot be built. */
async function buildScrubbedCopy(
  admin: Admin,
  organizationId: string,
  report: { description: string | null; context: unknown },
) {
  // A report whose originals the deletion run removed has nothing left to scrub.
  if (report.description === null) return null;
  try {
    // A context of any other shape is never copied.
    const context = parseStoredProblemReportContext(report.context);
    const catalog = loadUiStringCatalog();
    const sources = await readDictionarySources(admin, organizationId);
    if (sources === null) return null;
    const dictionary = buildScrubDictionary(sources, catalog);
    return {
      description: scrubReportText(report.description, dictionary),
      context: context === null ? {} : scrubReportContext(context, catalog, dictionary),
    };
  } catch (error) {
    logError('scrubStoredProblemReport: scrub failed', error);
    return null;
  }
}

/**
 * Whether a written copy still holds what identifies its organization: the
 * organization's own name or a record id, in its text or a token.
 * A copy written before those rules existed is checked again before it may
 * leave WerkFlow (docs/technical/problem-report-scrubbing.md, "Hand-out"). A
 * missing catalog throws, so the caller hands nothing out.
 */
export function copyNamesItsOrganization(
  copy: { description: string; context: ScrubbedProblemReportContext | null },
  organization: { name: string; unique_code: string },
): boolean {
  const dictionary = buildScrubDictionary(
    {
      customerNames: [organization.name],
      personNames: [],
      siteNames: [],
      addresses: [],
      phones: [],
      identifiers: [organization.unique_code],
    },
    loadUiStringCatalog(),
  );
  if (scrubReportText(copy.description, dictionary) !== copy.description) return true;
  const tokens = copy.context
    ? [
        copy.context.appVersion,
        ...copy.context.clientErrors.flatMap((error) => [error.name, error.code, error.digest]),
      ]
    : [];
  return tokens.some(
    (token) => token !== null && (holdsIdentifier(token, dictionary) || dictionaryKnows(dictionary, token)),
  );
}

/**
 * Scrubs one stored report of the organization and writes the scrubbed copy
 * with its state in one database call. Call it after a report is saved; the
 * daily run calls it for every report still without a copy, and for every
 * copy of older rules while its originals exist. It never throws and never
 * fails its caller: it resolves true when the report has a copy of the
 * current rules afterwards, and false when it has none. A report that
 * already has a current copy keeps it; a failed scrub never removes a copy.
 */
export async function scrubStoredProblemReport(organizationId: string, reportId: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const report = await admin
      .from('problem_reports')
      .select('description, context, scrub_state, scrub_version')
      .eq('organization_id', organizationId)
      .eq('id', reportId)
      .maybeSingle();
    let copy: Awaited<ReturnType<typeof buildScrubbedCopy>> = null;
    if (report.error) logError('scrubStoredProblemReport: report read failed', report.error);
    else if (report.data === null) return false;
    else if (report.data.scrub_state === 'bereinigt' && report.data.scrub_version === SCRUB_RULES_VERSION)
      return true;
    else copy = await buildScrubbedCopy(admin, organizationId, report.data);
    const written = await admin.rpc(
      'record_problem_report_scrub',
      rpcArgs('record_problem_report_scrub', {
        p_organization_id: organizationId,
        p_report_id: reportId,
        p_scrubbed_description: copy?.description ?? null,
        p_scrubbed_context: copy?.context ?? null,
        p_scrub_version: SCRUB_RULES_VERSION,
      }),
    );
    if (written.error) {
      logError('scrubStoredProblemReport: write failed', written.error);
      return false;
    }
    return written.data === 'bereinigt';
  } catch (error) {
    logError('scrubStoredProblemReport: failed', error);
    return false;
  }
}

type PendingScrubResult = { ok: boolean; scrubbed: number; notScrubbed: number };

/**
 * One page, in id order, of the reports of every organization that have no
 * scrubbed copy and either still have their originals, or lost them to the
 * deletion run while still `ausstehend`: their scrub records `nicht_bereinigbar`.
 */
async function readPendingPage(admin: Admin, after: string | null) {
  // tenant-scope: cross-organization-by-design — the scheduled run has no caller and spans every organization; each listed report names its organization, which its scrub passes to every read and to the write
  const pending = admin
    .from('problem_reports')
    .select('id, organization_id')
    .neq('scrub_state', 'bereinigt')
    .or('originals_deleted_at.is.null,scrub_state.eq.ausstehend')
    .order('id')
    .limit(PENDING_PAGE_SIZE);
  return after === null ? pending : pending.gt('id', after);
}

/**
 * One page, in id order, of the copies of older scrub rules whose originals
 * still exist: the daily run writes each again with the current rules.
 */
async function readOutdatedPage(admin: Admin, after: string | null) {
  // tenant-scope: cross-organization-by-design — the scheduled run has no caller and spans every organization; each listed report names its organization, which its scrub passes to every read and to the write
  const outdated = admin
    .from('problem_reports')
    .select('id, organization_id')
    .eq('scrub_state', 'bereinigt')
    .is('originals_deleted_at', null)
    .or(`scrub_version.is.null,scrub_version.lt.${SCRUB_RULES_VERSION}`)
    .order('id')
    .limit(PENDING_PAGE_SIZE);
  return after === null ? outdated : outdated.gt('id', after);
}

/**
 * Scrubs every report that has its originals but no scrubbed copy: one saved
 * before the scrubber existed, one whose scrub never ran, and one whose last
 * scrub failed. A report whose originals the deletion run removed before any
 * scrub succeeded keeps no text; it ends as `nicht_bereinigbar` and is left
 * alone afterwards. Then it scrubs every copy of older rules again while its
 * originals exist; one without them never leaves WerkFlow. Each list goes
 * page by page in id order, so a report that stays unscrubbed never stops the
 * run from reaching the next ones.
 */
export async function scrubPendingProblemReports(): Promise<PendingScrubResult> {
  const admin = createSupabaseAdminClient();
  const result: PendingScrubResult = { ok: true, scrubbed: 0, notScrubbed: 0 };
  for (const readPage of [readPendingPage, readOutdatedPage]) {
    let after: string | null = null;
    for (;;) {
      const page = await readPage(admin, after);
      if (page.error) {
        logError('scrubPendingProblemReports: list failed', page.error);
        return { ...result, ok: false };
      }
      for (const report of page.data) {
        if (await scrubStoredProblemReport(report.organization_id, report.id)) result.scrubbed += 1;
        else result.notScrubbed += 1;
      }
      const last = page.data.at(-1);
      if (last === undefined || page.data.length < PENDING_PAGE_SIZE) break;
      after = last.id;
    }
  }
  return result;
}
