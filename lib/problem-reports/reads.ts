import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { PROBLEM_REPORT_STATUSES, type OwnProblemReport, type ProblemReportFileKind } from './types';

// Server reads of problem reports for an authorized caller. Each one filters
// by the organization of the resolved context and by the caller as reporter
// or filer, so no member reaches another person's report.

/** The columns a reporter reads of their own report: no scrubbed copy, no context. */
export const OWN_REPORT_COLUMNS = 'id, number, created_at, status, closed_at, response, description';

type OwnReportRow = {
  id: string;
  number: number;
  created_at: string;
  status: string;
  closed_at: string | null;
  response: string | null;
  description: string | null;
};

export function toOwnProblemReport(row: OwnReportRow): OwnProblemReport {
  return {
    id: row.id,
    number: row.number,
    createdAt: row.created_at,
    status: constrainedValue(PROBLEM_REPORT_STATUSES, row.status, 'problem_reports.status'),
    closedAt: row.closed_at,
    response: row.response,
    description: row.description,
  };
}

/**
 * The report the caller filed in the organization, while it still keeps its
 * originals: only then may it take a file. Another person's report, a report
 * of another organization and a missing one read alike as `report_not_found`.
 */
export async function readFilableReport(
  admin: AdminClient,
  caller: { orgId: string; userId: string },
  reportId: string,
): Promise<ActionResult<object, 'report_not_found' | 'report_originals_deleted' | 'load_failed'>> {
  const { data, error } = await loggedRead(
    'readFilableReport: report read failed',
    admin
      .from('problem_reports')
      .select('id, originals_deleted_at')
      .eq('organization_id', caller.orgId)
      .eq('filed_by_id', caller.userId)
      .eq('id', reportId)
      .maybeSingle(),
  );
  if (error) return { success: false, error: 'load_failed' };
  if (!data) return { success: false, error: 'report_not_found' };
  if (data.originals_deleted_at !== null) return { success: false, error: 'report_originals_deleted' };
  return { success: true };
}

/** Whether a file of the report is already registered under the id: undefined when the read failed. */
export async function isRegisteredFile(
  admin: AdminClient,
  organizationId: string,
  reportId: string,
  fileId: string,
): Promise<boolean | undefined> {
  const { data, error } = await loggedRead(
    'isRegisteredFile: file read failed',
    admin
      .from('problem_report_files')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('report_id', reportId)
      .eq('id', fileId)
      .maybeSingle(),
  );
  if (error) return undefined;
  return data !== null;
}

/**
 * The key of one report file: `{organizationId}/problem-reports/{reportId}/{fileId}/{kind}`.
 * It holds no file name, so no name a person chose reaches a key, the purge
 * queue or a log; the row keeps the name.
 */
export function problemReportFilePath(file: {
  organizationId: string;
  reportId: string;
  fileId: string;
  kind: ProblemReportFileKind;
}): string {
  return `${file.organizationId}/problem-reports/${file.reportId}/${file.fileId}/${file.kind}`;
}
