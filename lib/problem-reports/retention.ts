import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The daily deletion of problem reports on the owner's periods
// (app/api/problem-report-retention/route.ts, docs/features/problem-reports.md).
// apply_problem_report_retention deletes one report's due originals, or the
// whole report once its scrubbed copy is due, in one call; the file rows it
// removes queue their objects for the storage purge. The result and the logs
// carry counts and codes only, never a report's content or a path.

const RETENTION_PAGE_SIZE = 200;

export type ProblemReportRetentionResult = {
  ok: boolean;
  originalsDeleted: number;
  reportsDeleted: number;
  failed: number;
};

/**
 * Applies every due deletion, page by page in id order. A report whose call
 * fails stays due for the next run and makes the result fail; the run goes
 * on with the next one.
 */
export async function runProblemReportRetention(): Promise<ProblemReportRetentionResult> {
  const admin = createSupabaseAdminClient();
  const result: ProblemReportRetentionResult = {
    ok: true,
    originalsDeleted: 0,
    reportsDeleted: 0,
    failed: 0,
  };
  let after: string | null = null;
  for (;;) {
    const page = await admin.rpc('list_problem_reports_due_for_retention', {
      p_limit: RETENTION_PAGE_SIZE,
      ...(after === null ? {} : { p_after: after }),
    });
    if (page.error) {
      logError('runProblemReportRetention: due list failed', page.error);
      return { ...result, ok: false };
    }
    const due: string[] = page.data;
    for (const reportId of due) {
      const { data: step, error: applyError } = await admin.rpc('apply_problem_report_retention', {
        p_report_id: reportId,
      });
      if (applyError) {
        logError('runProblemReportRetention: deletion failed', applyError);
        result.failed += 1;
        result.ok = false;
      } else if (step === 'originals_deleted') result.originalsDeleted += 1;
      else if (step === 'report_deleted') result.reportsDeleted += 1;
    }
    const last = due.at(-1);
    if (last === undefined || due.length < RETENTION_PAGE_SIZE) return result;
    after = last;
  }
}
