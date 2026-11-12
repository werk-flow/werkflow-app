'use server';

import { logError } from '@/lib/logging';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { resolveActionContext, resolveActionContextFor } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { OWN_REPORT_COLUMNS, toOwnProblemReport } from './reads';
import { submitProblemReportInputSchema, type SubmitProblemReportInput } from './schemas';
import type { OwnProblemReportsResult, SubmitProblemReportResult } from './types';

// A member's own problem reports (docs/features/problem-reports.md). Every
// role reports and reads only what they reported themselves; no customer
// role reads another person's report, `admin` included.

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;
const refusal = writeRefusalFor(new Set(['report_conflict']));

/**
 * Stores a report in the organization the caller reported from, with the
 * original description and the captured context. The caller must be a
 * current member there; the report starts as `eingegangen` with its scrubbed
 * copy pending, and takes the next number of the organization. It saves once
 * under the id the device chose: a retry gets the same report back.
 */
export async function submitProblemReport(
  rawInput: SubmitProblemReportInput,
): Promise<SubmitProblemReportResult> {
  const parsed = submitProblemReportInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveActionContextFor(input.organizationId);
  if (!auth.success) return auth;

  const { data, error } = await createSupabaseAdminClient().rpc(
    'submit_problem_report',
    rpcArgs('submit_problem_report', {
      p_report_id: input.reportId,
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_description: input.description,
      p_context: input.context,
    }),
  );
  if (error) return refusal(error, 'submit_failed', 'submitProblemReport: save failed');
  return { success: true, reportId: input.reportId, number: data };
}

/** The caller's own reports in the active organization, newest first. */
export async function listOwnProblemReports(): Promise<OwnProblemReportsResult> {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('problem_reports')
        .select(OWN_REPORT_COLUMNS)
        .eq('organization_id', auth.context.orgId)
        .eq('reporter_id', auth.context.userId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('listOwnProblemReports: read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, reports: data.map(toOwnProblemReport) };
}
