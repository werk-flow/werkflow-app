import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { formatProfileName } from '@/lib/members/profile-name';
import { createSignedDownloadUrl } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { otherSupportUserIds, supportUserIds } from '@/lib/support/allowlist';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { z } from '@/lib/zod';
import {
  parseScrubbedProblemReportContext,
  problemReportContextSchema,
  type ScrubbedProblemReportContext,
  type SupportQueueQuery,
} from './schemas';
import {
  PROBLEM_REPORT_BUCKETS,
  PROBLEM_REPORT_SCRUB_STATES,
  PROBLEM_REPORT_STATUSES,
  type ProblemReportOriginalResult,
  type SupportAssignee,
  type SupportFilingOptionsResult,
  type SupportQueueEntry,
  type SupportQueueResult,
  type SupportReportHistoryEntry,
  type SupportReportResult,
} from './types';

// What WerkFlow support reads of problem reports, across every organization
// (docs/features/problem-reports.md, "Support"). The caller of each function
// here admitted a support person from the allowlist first. The queue and a
// report's page hold the scrubbed copy and the redrawn screenshot; a report
// whose copy is not written yet shows its scrub state and no text. The
// originals leave only through `openProblemReportOriginalAs` and
// `signProblemReportAttachmentAs`, which write the opening into the history
// before they answer.

const LOAD_FAILED = { success: false, error: 'load_failed' } as const;
const REPORT_NOT_FOUND = { success: false, error: 'report_not_found' } as const;

/** How much of the scrubbed copy a queue row carries. */
const QUEUE_EXCERPT_LENGTH = 280;
/** How long the address of an attachment support opened stays valid. */
const ATTACHMENT_URL_EXPIRES_SECONDS = 120;
const FORMER_SUPPORT_PERSON = 'Früheres Support-Mitglied';
/** The actor of a report thread's history entries, which carry no account. */
const AGENT_ACTOR = 'Agent';

const QUEUE_COLUMNS =
  'id, number, organization_id, created_at, status, bucket, assignee_id, reporter_id, filed_by_id, scrub_state, scrubbed_description, originals_deleted_at';

type QueueRow = {
  id: string;
  number: number;
  organization_id: string;
  created_at: string;
  status: string;
  bucket: string | null;
  assignee_id: string | null;
  reporter_id: string;
  filed_by_id: string | null;
  scrub_state: string;
  scrubbed_description: string | null;
  originals_deleted_at: string | null;
};

/** The display names of the given users, from the profiles the server already holds. */
async function readProfileNames(
  admin: AdminClient,
  userIds: readonly string[],
): Promise<Map<string, string> | null> {
  const { data, error } = await readInBatches([...new Set(userIds)], (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (error) {
    logError('readProfileNames: profile read failed', error);
    return null;
  }
  return new Map(data.map((profile) => [profile.id, formatProfileName(profile)]));
}

async function readOrganizationNames(
  admin: AdminClient,
  organizationIds: readonly string[],
): Promise<Map<string, string> | null> {
  const { data, error } = await readInBatches([...new Set(organizationIds)], (batch) =>
    admin
      .from('organizations')
      .select('id, name')
      .in('id', [...batch]),
  );
  if (error) {
    logError('readOrganizationNames: organization read failed', error);
    return null;
  }
  return new Map(data.map((organization) => [organization.id, organization.name]));
}

/** The scrubbed copy only once the scrubber wrote it; an unscrubbed text never stands in for it. */
function scrubbedCopy(row: Pick<QueueRow, 'scrub_state' | 'scrubbed_description'>): string | null {
  return row.scrub_state === 'bereinigt' ? row.scrubbed_description : null;
}

/**
 * The scrubbed context beside the scrubbed copy: null for a report taken by
 * phone or without a copy. A stored shape the scrubber never writes fails the
 * read.
 */
function readScrubbedContext(
  row: Pick<QueueRow, 'scrub_state'> & { scrubbed_context: Json | null },
): { success: true; context: ScrubbedProblemReportContext | null } | typeof LOAD_FAILED {
  if (row.scrub_state !== 'bereinigt') return { success: true, context: null };
  try {
    return { success: true, context: parseScrubbedProblemReportContext(row.scrubbed_context) };
  } catch (thrown) {
    logError('readSupportReport: the scrubbed context has an unknown shape', thrown);
    return LOAD_FAILED;
  }
}

function toQueueEntry(
  row: QueueRow,
  organizationNames: ReadonlyMap<string, string>,
  profileNames: ReadonlyMap<string, string>,
  copy: string | null,
): SupportQueueEntry {
  const bucket = PROBLEM_REPORT_BUCKETS.find((candidate) => candidate === row.bucket) ?? null;
  return {
    id: row.id,
    number: row.number,
    organizationName: organizationNames.get(row.organization_id) ?? '',
    createdAt: row.created_at,
    status: constrainedValue(PROBLEM_REPORT_STATUSES, row.status, 'problem_reports.status'),
    bucket,
    assigneeName:
      row.assignee_id === null ? null : (profileNames.get(row.assignee_id) ?? FORMER_SUPPORT_PERSON),
    scrubState: constrainedValue(PROBLEM_REPORT_SCRUB_STATES, row.scrub_state, 'problem_reports.scrub_state'),
    scrubbedDescription: copy,
    originalsDeleted: row.originals_deleted_at !== null,
    filedForCaller: row.filed_by_id !== row.reporter_id,
  };
}

/** One page of every organization's reports, oldest first, under the status and bucket filters. */
export async function readSupportQueuePage(
  admin: AdminClient,
  query: SupportQueueQuery,
): Promise<SupportQueueResult> {
  const from = (query.page - 1) * LIST_PAGE_SIZE;
  let page = admin
    // tenant-scope: cross-organization-by-design — WerkFlow support triages the reports of every organization in one queue
    .from('problem_reports')
    .select(QUEUE_COLUMNS, { count: 'exact' });
  if (query.status === 'offen') page = page.in('status', ['eingegangen', 'in_bearbeitung']);
  else if (query.status !== 'alle') page = page.eq('status', query.status);
  if (query.bucket === 'ohne') page = page.is('bucket', null);
  else if (query.bucket !== 'alle') page = page.eq('bucket', query.bucket);
  const { data, error, count } = await loggedRead(
    'readSupportQueuePage: report read failed',
    page
      .order('created_at')
      .order('id')
      .range(from, from + LIST_PAGE_SIZE - 1),
  );
  if (error || count === null) return LOAD_FAILED;

  const [organizationNames, profileNames] = await Promise.all([
    readOrganizationNames(
      admin,
      data.map((row) => row.organization_id),
    ),
    readProfileNames(
      admin,
      data.flatMap((row) => (row.assignee_id === null ? [] : [row.assignee_id])),
    ),
  ]);
  if (!organizationNames || !profileNames) return LOAD_FAILED;
  return {
    success: true,
    page: {
      total: count,
      entries: data.map((row) => {
        const copy = scrubbedCopy(row);
        const excerpt =
          copy !== null && copy.length > QUEUE_EXCERPT_LENGTH
            ? `${copy.slice(0, QUEUE_EXCERPT_LENGTH)}…`
            : copy;
        return toQueueEntry(row, organizationNames, profileNames, excerpt);
      }),
    },
  };
}

/** The allowlisted support persons with their names, for the assignee choice. */
function assigneesOf(profileNames: ReadonlyMap<string, string>): SupportAssignee[] {
  return [...(supportUserIds() ?? [])]
    .map((userId) => ({ userId, name: profileNames.get(userId) ?? FORMER_SUPPORT_PERSON }))
    .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

const historyPayloadSchema = z.object({
  to: z.string().nullable().optional(),
  file_id: z.string().optional(),
});

type HistoryRow = {
  id: string;
  event_type: string;
  actor_id: string | null;
  payload: Json;
  created_at: string;
};

function toHistoryChange(
  row: HistoryRow,
  profileNames: ReadonlyMap<string, string>,
): SupportReportHistoryEntry['change'] | null {
  const payload = historyPayloadSchema.safeParse(row.payload);
  const to = payload.success ? (payload.data.to ?? null) : null;
  switch (row.event_type) {
    case 'status_changed':
      return { kind: 'status', to: PROBLEM_REPORT_STATUSES.find((status) => status === to) ?? null };
    case 'bucket_changed':
      return { kind: 'bucket', to: PROBLEM_REPORT_BUCKETS.find((bucket) => bucket === to) ?? null };
    case 'assignee_changed':
      return {
        kind: 'assignee',
        toName: to === null ? null : (profileNames.get(to) ?? FORMER_SUPPORT_PERSON),
      };
    case 'response_changed':
      return { kind: 'response' };
    case 'original_opened':
      return { kind: 'original_opened', attachment: payload.success && payload.data.file_id !== undefined };
    case 'copy_handed_out':
      return { kind: 'handed_out', part: 'copy' };
    case 'screenshot_handed_out':
      return { kind: 'handed_out', part: 'screenshot' };
    default:
      // An entry of a kind a newer release writes: left out, never guessed.
      return null;
  }
}

/** The assignee ids a history names, so their names load in one read. */
function assigneeIdsOf(history: readonly HistoryRow[]): string[] {
  return history.flatMap((row) => {
    const payload = historyPayloadSchema.safeParse(row.payload);
    const to = payload.success ? payload.data.to : null;
    return row.event_type === 'assignee_changed' && typeof to === 'string' ? [to] : [];
  });
}

function toReportHistory(
  rows: readonly HistoryRow[],
  profileNames: ReadonlyMap<string, string>,
): SupportReportHistoryEntry[] {
  return rows.flatMap((event) => {
    const change = toHistoryChange(event, profileNames);
    if (!change) return [];
    return [
      {
        id: event.id,
        createdAt: event.created_at,
        actorName:
          event.actor_id === null ? AGENT_ACTOR : (profileNames.get(event.actor_id) ?? FORMER_SUPPORT_PERSON),
        change,
      },
    ];
  });
}

/** A short-lived address of the report's redrawn screenshot; `url` is null when it has none. */
async function signScreenshot(
  organizationId: string,
  files: readonly { kind: string; storage_path: string }[],
): Promise<ActionResult<{ url: string | null }, 'load_failed'>> {
  const screenshot = files.find((file) => file.kind === 'screenshot');
  if (!screenshot) return { success: true, url: null };
  try {
    const url = await createSignedDownloadUrl({ organizationId, path: screenshot.storage_path });
    return { success: true, url };
  } catch (signError) {
    logError('signScreenshot: signing failed', signError);
    return LOAD_FAILED;
  }
}

/** One report for support's work on it: no original text, no attachment. */
export async function readSupportReport(admin: AdminClient, reportId: string): Promise<SupportReportResult> {
  const { data: row, error } = await loggedRead(
    'readSupportReport: report read failed',
    admin
      // tenant-scope: cross-organization-by-design — WerkFlow support opens a report of any organization
      .from('problem_reports')
      .select(`${QUEUE_COLUMNS}, response, response_by_agent, scrubbed_context`)
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (error) return LOAD_FAILED;
  if (!row) return REPORT_NOT_FOUND;

  const [files, history] = await Promise.all([
    loggedRead(
      'readSupportReport: file read failed',
      admin
        // tenant-scope: child-of-verified-parent — the files of the one report support opened
        .from('problem_report_files')
        .select('id, kind, storage_path')
        .eq('report_id', row.id)
        .order('created_at')
        .order('id')
        .range(0, LIST_PAGE_SIZE - 1),
    ),
    readCompleteRows(
      (from, to) =>
        admin
          // tenant-scope: child-of-verified-parent — the history of the one report support opened
          .from('problem_report_events')
          .select('id, event_type, actor_id, payload, created_at')
          .eq('report_id', row.id)
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (files.error) return LOAD_FAILED;
  if (history.error) {
    logError('readSupportReport: history read failed', history.error);
    return LOAD_FAILED;
  }

  const [organizationNames, profileNames] = await Promise.all([
    readOrganizationNames(admin, [row.organization_id]),
    readProfileNames(admin, [
      ...(supportUserIds() ?? []),
      ...(row.assignee_id === null ? [] : [row.assignee_id]),
      ...history.data.flatMap((event) => (event.actor_id === null ? [] : [event.actor_id])),
      ...assigneeIdsOf(history.data),
    ]),
  ]);
  if (!organizationNames || !profileNames) return LOAD_FAILED;

  const scrubbedContext = readScrubbedContext(row);
  if (!scrubbedContext.success) return scrubbedContext;
  const screenshot = await signScreenshot(row.organization_id, files.data);
  if (!screenshot.success) return screenshot;
  return {
    success: true,
    report: {
      ...toQueueEntry(row, organizationNames, profileNames, scrubbedCopy(row)),
      assigneeId: row.assignee_id,
      response: row.response,
      responseByAgent: row.response_by_agent,
      scrubbedContext: scrubbedContext.context,
      screenshotUrl: screenshot.url,
      attachmentCount: files.data.filter((file) => file.kind === 'anhang').length,
      assignees: assigneesOf(profileNames),
      history: toReportHistory(history.data, profileNames),
    },
  };
}

type OriginalRow = {
  id: string;
  organization_id: string;
  reporter_id: string;
  description: string;
  context: Json;
};

/** A report with its originals, or `report: null` once their deletion period removed them. */
async function readOriginals(
  admin: AdminClient,
  reportId: string,
): Promise<ActionResult<{ report: OriginalRow | null }, 'report_not_found' | 'load_failed'>> {
  const { data: report, error } = await loggedRead(
    'readOriginals: report read failed',
    admin
      // tenant-scope: cross-organization-by-design — WerkFlow support opens the original of a report of any organization
      .from('problem_reports')
      .select('id, organization_id, reporter_id, description, context, originals_deleted_at')
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (error) return LOAD_FAILED;
  if (!report) return REPORT_NOT_FOUND;
  if (report.originals_deleted_at !== null || report.description === null || report.context === null)
    return { success: true, report: null };
  return { success: true, report: { ...report, description: report.description, context: report.context } };
}

/**
 * Writes the opening of an original, or of one attachment, into the report's
 * history and signals the other support persons, in one call. The caller
 * hands the original out only after this answered true.
 */
async function recordOpening(
  admin: AdminClient,
  actorId: string,
  report: OriginalRow,
  fileId: string | null,
): Promise<boolean> {
  const { error } = await admin.rpc(
    'record_problem_report_opening',
    // tenant-scope: cross-organization-by-design — support opens a report of any organization; the loaded report's own organization scopes the call
    openingArguments(report, actorId, fileId),
  );
  if (error) logError('recordOpening: opening history failed', error);
  return !error;
}

/** The arguments of an opening of one loaded report. */
function openingArguments(report: OriginalRow, actorId: string, fileId: string | null) {
  return rpcArgs('record_problem_report_opening', {
    p_organization_id: report.organization_id,
    p_report_id: report.id,
    p_actor_id: actorId,
    p_file_id: fileId,
    p_support_ids: otherSupportUserIds(actorId),
  });
}

/**
 * The original description, the reporter and the attachment list of one
 * report, for the support person `actorId`. A report whose originals are
 * deleted answers `original: null` and gets no history entry.
 */
export async function openProblemReportOriginalAs(
  admin: AdminClient,
  actorId: string,
  reportId: string,
): Promise<ProblemReportOriginalResult> {
  const read = await readOriginals(admin, reportId);
  if (!read.success) return read;
  const report = read.report;
  if (!report) return { success: true, original: null };

  const [attachments, profileNames] = await Promise.all([
    loggedRead(
      'openProblemReportOriginalAs: file read failed',
      admin
        // tenant-scope: child-of-verified-parent — the attachments of the one report whose original support opens
        .from('problem_report_files')
        .select('id, file_name, mime_type, size_bytes')
        .eq('report_id', report.id)
        .eq('kind', 'anhang')
        .order('created_at')
        .order('id')
        .range(0, LIST_PAGE_SIZE - 1),
    ),
    readProfileNames(admin, [report.reporter_id]),
  ]);
  if (attachments.error || !profileNames) return LOAD_FAILED;
  if (!(await recordOpening(admin, actorId, report, null))) return LOAD_FAILED;
  const context = problemReportContextSchema.safeParse(report.context);
  return {
    success: true,
    original: {
      description: report.description,
      reporterName: profileNames.get(report.reporter_id) ?? 'Unbekannt',
      context: context.success ? context.data : null,
      attachments: attachments.data.map((file) => ({
        id: file.id,
        fileName: file.file_name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
      })),
    },
  };
}

/** A short-lived download address of one attachment, for the support person `actorId`. */
export async function signProblemReportAttachmentAs(
  admin: AdminClient,
  actorId: string,
  target: { reportId: string; fileId: string },
): Promise<ActionResult<{ url: string }>> {
  const read = await readOriginals(admin, target.reportId);
  if (!read.success) return read;
  const report = read.report;
  if (!report) return { success: false, error: 'file_not_found' };
  const { data: file, error: fileError } = await loggedRead(
    'signProblemReportAttachmentAs: file read failed',
    admin
      // tenant-scope: child-of-verified-parent — one attachment of the report whose original support opens
      .from('problem_report_files')
      .select('id, storage_path, file_name')
      .eq('report_id', report.id)
      .eq('id', target.fileId)
      .eq('kind', 'anhang')
      .maybeSingle(),
  );
  if (fileError) return LOAD_FAILED;
  if (!file) return { success: false, error: 'file_not_found' };

  if (!(await recordOpening(admin, actorId, report, file.id))) return LOAD_FAILED;
  try {
    const url = await createSignedDownloadUrl({
      organizationId: report.organization_id,
      path: file.storage_path,
      disposition: 'attachment',
      downloadFileName: file.file_name,
      expiresInSeconds: ATTACHMENT_URL_EXPIRES_SECONDS,
    });
    return { success: true, url };
  } catch (signError) {
    logError('signProblemReportAttachmentAs: signing failed', signError);
    return { success: false, error: 'sign_failed' };
  }
}

/** Every organization, and the members of the chosen one, for a report filed for a caller. */
export async function readSupportFilingOptions(
  admin: AdminClient,
  organizationId: string | null,
): Promise<SupportFilingOptionsResult> {
  const organizations = await readCompleteRows(
    (from, to) => admin.from('organizations').select('id, name').order('name').order('id').range(from, to),
    LIST_ROW_CAP,
  );
  if (organizations.error) {
    logError('readSupportFilingOptions: organization read failed', organizations.error);
    return LOAD_FAILED;
  }
  const [chosen] = organizations.data.filter((organization) => organization.id === organizationId);
  if (!chosen) return { success: true, options: { organizations: organizations.data, members: [] } };

  const members = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', chosen.id)
        .order('user_id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (members.error) {
    logError('readSupportFilingOptions: member read failed', members.error);
    return LOAD_FAILED;
  }
  const userIds = members.data.map((member) => member.user_id);
  const profileNames = await readProfileNames(admin, userIds);
  if (!profileNames) return LOAD_FAILED;
  return {
    success: true,
    options: {
      organizations: organizations.data,
      members: userIds
        .map((userId) => ({ userId, name: profileNames.get(userId) ?? 'Unbekannt' }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de')),
    },
  };
}
