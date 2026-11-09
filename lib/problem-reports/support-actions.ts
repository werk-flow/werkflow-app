'use server';

import type { ActionResult } from '@/lib/action-result';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { supportAccessOf } from '@/lib/support/allowlist';
import type { Json } from '@/lib/supabase/database.types';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  PROBLEM_REPORT_FILE_KINDS,
  PROBLEM_REPORT_MAX_ATTACHMENTS,
  PROBLEM_REPORT_STATUSES,
  type ProblemReportFileKind,
  type ProblemReportStatus,
} from './types';

// WerkFlow support opens a report of any organization (owner's answer on
// werk-flow/werkflow-planning#21). Support is no organization role: the
// server admits only the verified users of the environment's allowlist
// (lib/support/allowlist.ts), and an allowlist it cannot read refuses. Every
// opening of an original enters the report's history before the original
// leaves the server.

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;

type SupportProblemReport = {
  id: string;
  organizationId: string;
  createdAt: string;
  status: ProblemReportStatus;
  /** Null once the deletion period removed the originals. */
  description: string | null;
  context: Json | null;
  files: { id: string; kind: ProblemReportFileKind; fileName: string; mimeType: string; sizeBytes: number }[];
};

type SupportProblemReportResult = ActionResult<
  { report: SupportProblemReport },
  | 'not_authenticated'
  | 'not_authorized'
  | 'support_unavailable'
  | 'invalid_input'
  | 'report_not_found'
  | 'load_failed'
>;

/** One report with its originals and file list, for WerkFlow support; the opening is logged first. */
export async function openProblemReportAsSupport(reportId: string): Promise<SupportProblemReportResult> {
  const id = uuidSchema.safeParse(reportId);
  if (!id.success) return INVALID_INPUT;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const access = supportAccessOf(user.id);
  if (access === 'unresolved') {
    logError('openProblemReportAsSupport: the support allowlist cannot be resolved');
    return { success: false, error: 'support_unavailable' };
  }
  if (access === 'not_support') return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const { data: report, error } = await loggedRead(
    'openProblemReportAsSupport: report read failed',
    admin
      // tenant-scope: cross-organization-by-design — WerkFlow support reads a report of any organization
      .from('problem_reports')
      .select('id, organization_id, created_at, status, description, context, originals_deleted_at')
      .eq('id', id.data)
      .maybeSingle(),
  );
  if (error) return { success: false, error: 'load_failed' };
  if (!report) return { success: false, error: 'report_not_found' };

  const { data: files, error: filesError } = await loggedRead(
    'openProblemReportAsSupport: file read failed',
    admin
      // tenant-scope: child-of-verified-parent — the files of the one report support was admitted to open
      .from('problem_report_files')
      .select('id, kind, file_name, mime_type, size_bytes')
      .eq('report_id', report.id)
      .order('created_at')
      .order('id')
      .limit(PROBLEM_REPORT_MAX_ATTACHMENTS + 1),
  );
  if (filesError) return { success: false, error: 'load_failed' };

  if (report.originals_deleted_at === null) {
    const { error: historyError } = await admin.from('problem_report_events').insert({
      organization_id: report.organization_id,
      report_id: report.id,
      event_type: 'original_opened',
      actor_id: user.id,
    });
    if (historyError) {
      logError('openProblemReportAsSupport: opening history failed', historyError);
      return { success: false, error: 'load_failed' };
    }
  }

  return {
    success: true,
    report: {
      id: report.id,
      organizationId: report.organization_id,
      createdAt: report.created_at,
      status: constrainedValue(PROBLEM_REPORT_STATUSES, report.status, 'problem_reports.status'),
      description: report.description,
      context: report.context,
      files: files.map((file) => ({
        id: file.id,
        kind: constrainedValue(PROBLEM_REPORT_FILE_KINDS, file.kind, 'problem_report_files.kind'),
        fileName: file.file_name,
        mimeType: file.mime_type,
        sizeBytes: file.size_bytes,
      })),
    },
  };
}
