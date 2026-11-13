import 'server-only';

import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { readStorageObject } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { supportUserIds } from '@/lib/support/allowlist';
import { SCRUB_RULES_VERSION } from './scrub/rule-version';
import { copyNamesItsOrganization } from './scrub/scrub-report';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { z } from '@/lib/zod';
import {
  parseScrubbedProblemReportContext,
  type ProblemReportWriteBack,
  type ScrubbedProblemReportContext,
} from './schemas';
import {
  PROBLEM_REPORT_BUCKETS,
  PROBLEM_REPORT_STATUSES,
  type ProblemReportBucket,
  type ProblemReportStatus,
} from './types';

// What report threads receive of a problem report, and what they write back
// (docs/features/problem-reports.md, "Hand-out to report threads"). The
// route handlers under app/api/problem-reports/v1/ checked the hand-out
// secret first; nothing here knows a user. A thread receives only the
// scrubbed copy: never an original, an attachment, a name, the organization
// or an id other than the report's own. Each hand-out enters the report's
// history in the database call that answers it, before anything leaves.

/** The refusals a thread reads as codes; every other failure is `failed`. */
const HANDOUT_REFUSALS = [
  'report_not_found',
  'copy_pending',
  'copy_unavailable',
  'report_closed',
  'already_handed_out',
  'report_not_handed_out',
  'no_screenshot',
] as const;
export type HandoutRefusal = (typeof HANDOUT_REFUSALS)[number];
export type HandoutResult<Data> = ({ ok: true } & Data) | { ok: false; error: HandoutRefusal | 'failed' };

/** The scrubbed copy a thread receives. */
export type HandedOutCopy = {
  reportId: string;
  description: string;
  /** Null for a report support filed for a caller, which has no captured context. */
  context: ScrubbedProblemReportContext | null;
  status: ProblemReportStatus;
  bucket: ProblemReportBucket | null;
  /** Whether the reporter has an answer; its text never leaves, since support writes it unscrubbed. */
  hasAnswer: boolean;
  /** The address of the redrawn screenshot on this API, or null without one. */
  screenshot: string | null;
};

/** What a write-back that met a newer triage answers: the report's state now, without any text. */
type CurrentReportState = Pick<HandedOutCopy, 'status' | 'bucket' | 'hasAnswer'>;
export type WriteBackResult =
  | HandoutResult<object>
  | { ok: false; error: 'triage_conflict'; current: CurrentReportState };

const FAILED = { ok: false, error: 'failed' } as const;
const NOT_FOUND = { ok: false, error: 'report_not_found' } as const;

function bucketOf(value: string | null): ProblemReportBucket | null {
  return PROBLEM_REPORT_BUCKETS.find((bucket) => bucket === value) ?? null;
}

/** The path of a report's screenshot on this API: it names nothing but the report. */
function handedOutScreenshotPath(reportId: string): string {
  return `/api/problem-reports/v1/reports/${reportId}/screenshot`;
}

/** Every support person, whose open queue and report pages follow a hand-out live. */
function supportSignalIds(): string[] {
  return [...(supportUserIds() ?? [])];
}

/** A refusal the database raised, by its code; anything else is logged and `failed`. */
function refusalOf(
  error: { message: string },
  logLabel: string,
): { ok: false; error: HandoutRefusal | 'failed' } {
  const refusal = HANDOUT_REFUSALS.find((code) => code === error.message);
  if (refusal) return { ok: false, error: refusal };
  logError(logLabel, error);
  return FAILED;
}

/**
 * How long a report waits after it was sent before a thread may take it: the
 * device uploads the screenshot after the save. hand_out_problem_report
 * refuses a younger report with the same interval.
 */
const HANDOUT_GRACE_MILLISECONDS = 10 * 60 * 1000;

/** A report waiting for a thread: its id and its bucket, which a dispatcher starts a blocker by. No text. */
type WaitingReport = { id: string; bucket: ProblemReportBucket | null };

/**
 * The reports waiting for a thread, oldest first: sent at least ten minutes
 * ago, with a scrubbed copy, not handed out and still open. Each names its id
 * and bucket only.
 */
export async function listWaitingProblemReports(
  admin: AdminClient,
): Promise<HandoutResult<{ reports: WaitingReport[] }>> {
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        // tenant-scope: cross-organization-by-design — report threads take the waiting reports of every organization, by id and bucket only
        .from('problem_reports')
        .select('id, bucket')
        .eq('scrub_state', 'bereinigt')
        .is('handed_out_at', null)
        .is('closed_at', null)
        .eq('scrub_version', SCRUB_RULES_VERSION)
        .lte('created_at', new Date(Date.now() - HANDOUT_GRACE_MILLISECONDS).toISOString())
        .order('created_at')
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('listWaitingProblemReports: report read failed', error);
    return FAILED;
  }
  return { ok: true, reports: data.map((row) => ({ id: row.id, bucket: bucketOf(row.bucket) })) };
}

/** The organization of one report, which scopes every call about it. */
async function loadReport(
  admin: AdminClient,
  reportId: string,
): Promise<HandoutResult<{ report: { id: string; organization_id: string } }>> {
  const { data, error } = await loggedRead(
    'problem report hand-out: report read failed',
    admin
      // tenant-scope: cross-organization-by-design — a report thread names a report of any organization by its id
      .from('problem_reports')
      .select('id, organization_id')
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (error) return FAILED;
  if (!data) return NOT_FOUND;
  return { ok: true, report: data };
}

/**
 * The second line behind the rule version: whether a copy of the current
 * rules still names its organization or holds a record id. Such a copy never
 * leaves (`copy_unavailable`) and is logged, without its text. A report
 * without a current copy passes here; the hand-out refuses it with its code.
 */
async function copyWithheld(
  admin: AdminClient,
  report: { id: string; organization_id: string },
): Promise<boolean | null> {
  const [copy, organization] = await Promise.all([
    loggedRead(
      'problem report hand-out: copy read failed',
      admin
        // tenant-scope: cross-organization-by-design — the copy of the one report a thread names, by its id
        .from('problem_reports')
        .select('scrub_state, scrub_version, scrubbed_description, scrubbed_context')
        .eq('id', report.id)
        .maybeSingle(),
    ),
    loggedRead(
      'problem report hand-out: organization read failed',
      admin.from('organizations').select('name').eq('id', report.organization_id).maybeSingle(),
    ),
  ]);
  if (copy.error || organization.error || !copy.data || !organization.data) return null;
  const { scrub_state: state, scrub_version: version, scrubbed_description: description } = copy.data;
  // A copy of older rules is refused by the hand-out itself.
  if (state !== 'bereinigt' || version !== SCRUB_RULES_VERSION || description === null) return false;
  try {
    const names = copyNamesItsOrganization(
      { description, context: parseScrubbedProblemReportContext(copy.data.scrubbed_context) },
      organization.data.name,
    );
    // A copy of the current rules never names its organization; when one
    // does, the rules missed a case, and it is held back and reported.
    if (names) logError('problem report hand-out: a current copy names its organization');
    return names;
  } catch (thrown) {
    logError('problem report hand-out: copy check failed', thrown);
    return null;
  }
}

/** The arguments of a screenshot hand-out about one loaded report. */
function handOutArguments(report: { id: string; organization_id: string }) {
  return {
    p_organization_id: report.organization_id,
    p_report_id: report.id,
    p_support_ids: supportSignalIds(),
  };
}

/** The arguments of a copy hand-out: only a copy of the current scrub rules leaves. */
function copyHandOutArguments(report: { id: string; organization_id: string }) {
  return { ...handOutArguments(report), p_scrub_version: SCRUB_RULES_VERSION };
}

/** The arguments of the Agent's triage of one loaded report: no actor. */
function writeBackArguments(
  report: { id: string; organization_id: string },
  writeBack: ProblemReportWriteBack,
) {
  return rpcArgs('triage_problem_report', {
    p_organization_id: report.organization_id,
    p_report_id: report.id,
    p_actor_id: null,
    p_changes: writeBack.changes,
    p_expected: writeBack.expected,
    p_support_ids: supportSignalIds(),
  });
}

// What the hand-out functions answer; any other shape fails the hand-out.
const handedOutRowSchema = z.strictObject({
  description: z.string(),
  context: z.unknown(),
  status: z.string(),
  bucket: z.string().nullable(),
  has_answer: z.boolean(),
  has_screenshot: z.boolean(),
});
const handedOutScreenshotSchema = z.strictObject({ path: z.string(), mime_type: z.string() });

/**
 * Hands one report's scrubbed copy to a thread, once. A copy that still
 * names its organization is held back first. The database call claims the
 * report and writes the hand-out into its history before it answers; a
 * report without a scrubbed copy, a younger one, a closed one and one already
 * handed out are refused with their codes.
 */
export async function handOutProblemReport(
  admin: AdminClient,
  reportId: string,
): Promise<HandoutResult<{ copy: HandedOutCopy }>> {
  const loaded = await loadReport(admin, reportId);
  if (!loaded.ok) return loaded;
  const withheld = await copyWithheld(admin, loaded.report);
  if (withheld === null) return FAILED;
  if (withheld) return { ok: false, error: 'copy_unavailable' };
  const { data, error } = await admin.rpc(
    'hand_out_problem_report',
    // tenant-scope: cross-organization-by-design — a report thread takes a report of any organization; the loaded report's own organization scopes the call
    rpcArgs('hand_out_problem_report', copyHandOutArguments(loaded.report)),
  );
  if (error) return refusalOf(error, 'handOutProblemReport: hand-out failed');
  try {
    const row = handedOutRowSchema.parse(data);
    return {
      ok: true,
      copy: {
        reportId: loaded.report.id,
        description: row.description,
        context: parseScrubbedProblemReportContext(row.context),
        status: constrainedValue(PROBLEM_REPORT_STATUSES, row.status, 'problem_reports.status'),
        bucket: bucketOf(row.bucket),
        hasAnswer: row.has_answer,
        screenshot: row.has_screenshot ? handedOutScreenshotPath(loaded.report.id) : null,
      },
    };
  } catch (thrown) {
    logError('handOutProblemReport: the scrubbed copy has an unknown shape', thrown);
    return FAILED;
  }
}

/**
 * The redrawn screenshot of a report whose copy a thread received. The
 * database call writes this hand-out into the history before the server
 * reads the bytes.
 */
export async function handOutProblemReportScreenshot(
  admin: AdminClient,
  reportId: string,
): Promise<HandoutResult<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string }>> {
  const loaded = await loadReport(admin, reportId);
  if (!loaded.ok) return loaded;
  const { data, error } = await admin.rpc(
    'hand_out_problem_report_screenshot',
    // tenant-scope: cross-organization-by-design — a report thread takes a report of any organization; the loaded report's own organization scopes the call
    rpcArgs('hand_out_problem_report_screenshot', handOutArguments(loaded.report)),
  );
  if (error) return refusalOf(error, 'handOutProblemReportScreenshot: hand-out failed');
  try {
    const row = handedOutScreenshotSchema.parse(data);
    const bytes = await readStorageObject({ organizationId: loaded.report.organization_id, path: row.path });
    return { ok: true, bytes: new Uint8Array(bytes), mimeType: row.mime_type };
  } catch (thrown) {
    logError('handOutProblemReportScreenshot: screenshot read failed', thrown);
    return FAILED;
  }
}

/** A report's status, bucket and whether it has an answer, after a write-back met a newer triage. */
async function readCurrentState(
  admin: AdminClient,
  report: { id: string; organization_id: string },
): Promise<CurrentReportState | null> {
  const { data, error } = await loggedRead(
    'writeBackProblemReport: state read failed',
    admin
      // tenant-scope: cross-organization-by-design — the one report a thread received, of any organization, by its id
      .from('problem_reports')
      .select('status, bucket, response')
      .eq('id', report.id)
      .maybeSingle(),
  );
  if (error || !data) return null;
  return {
    status: constrainedValue(PROBLEM_REPORT_STATUSES, data.status, 'problem_reports.status'),
    bucket: bucketOf(data.bucket),
    hasAnswer: data.response !== null,
  };
}

/**
 * Writes a thread's bucket, status and answer to one report it received, in
 * one triage call without an actor: the history names the Agent, the answer
 * is marked as written automatically, and the reporter and support see the
 * change live. Each change names the value it was based on; when a field
 * holds another value by now, nothing is written and the thread gets the
 * report's current state to decide again, never support's answer.
 */
export async function writeBackProblemReport(
  admin: AdminClient,
  reportId: string,
  writeBack: ProblemReportWriteBack,
): Promise<WriteBackResult> {
  const loaded = await loadReport(admin, reportId);
  if (!loaded.ok) return loaded;
  const { error } = await admin.rpc(
    'triage_problem_report',
    // tenant-scope: cross-organization-by-design — a report thread answers a report of any organization; the loaded report's own organization scopes the call
    writeBackArguments(loaded.report, writeBack),
  );
  if (!error) return { ok: true };
  if (error.message !== 'triage_conflict')
    return refusalOf(error, 'writeBackProblemReport: write-back failed');
  const current = await readCurrentState(admin, loaded.report);
  return current ? { ok: false, error: 'triage_conflict', current } : FAILED;
}
