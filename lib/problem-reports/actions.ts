'use server';

import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { resolveActionContext, resolveActionContextFor } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { OWN_REPORT_COLUMNS, toOwnProblemReport } from './reads';
import { submitProblemReportInputSchema, type SubmitProblemReportInput } from './schemas';
import type { OwnProblemReportResult, OwnProblemReportsResult, SubmitProblemReportResult } from './types';

// A member's own problem reports (docs/features/problem-reports.md). Every
// role reports and reads only what they reported themselves; no customer
// role reads another person's report, `admin` included.

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;

/**
 * Stores a report in the organization the caller reported from, with the
 * original description and the captured context. The caller must be a
 * current member there; the report starts as `eingegangen` with its scrubbed
 * copy pending.
 */
export async function submitProblemReport(
  rawInput: SubmitProblemReportInput,
): Promise<SubmitProblemReportResult> {
  const parsed = submitProblemReportInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveActionContextFor(input.organizationId);
  if (!auth.success) return auth;

  const { data, error } = await createSupabaseAdminClient()
    .from('problem_reports')
    .insert({
      organization_id: auth.context.orgId,
      reporter_id: auth.context.userId,
      filed_by_id: auth.context.userId,
      description: input.description,
      context: input.context,
    })
    .select('id')
    .single();
  if (error) {
    logError('submitProblemReport: insert failed', error);
    return { success: false, error: 'submit_failed' };
  }
  return { success: true, reportId: data.id };
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

/** One of the caller's own reports in the active organization; any other reads as not found. */
export async function readOwnProblemReport(reportId: string): Promise<OwnProblemReportResult> {
  const id = uuidSchema.safeParse(reportId);
  if (!id.success) return INVALID_INPUT;
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  const { data, error } = await loggedRead(
    'readOwnProblemReport: read failed',
    createSupabaseAdminClient()
      .from('problem_reports')
      .select(OWN_REPORT_COLUMNS)
      .eq('organization_id', auth.context.orgId)
      .eq('reporter_id', auth.context.userId)
      .eq('id', id.data)
      .maybeSingle(),
  );
  if (error) return { success: false, error: 'load_failed' };
  if (!data) return { success: false, error: 'report_not_found' };
  return { success: true, report: toOwnProblemReport(data) };
}
