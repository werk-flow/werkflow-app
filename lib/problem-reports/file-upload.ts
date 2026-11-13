import 'server-only';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import {
  createSignedUploadUrl,
  discardStorageObjects,
  promoteUploadedObject,
  uploadStagingPath,
} from '@/lib/storage/r2';
import { uploadRuleFailure } from '@/lib/storage/upload-rules';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';
import { isRegisteredFile, problemReportFilePath, readFilableReport, type ReportFiler } from './reads';
import {
  PROBLEM_REPORT_FILE_RULES,
  PROBLEM_REPORT_MAX_ATTACHMENTS,
  type ProblemReportFileKind,
  type ProblemReportFileUploadTicketResult,
} from './types';

// The screenshot and attachments of a problem report follow the document
// upload flow (docs/technical/document-storage-and-access.md, "Report
// files"): the ticket signs a PUT for a staging key, the browser moves the
// bytes, and the finalize copies them to a key of its own, checks type and
// size, and registers the copy in one database call. Only the person who
// filed the report adds files, and only while it keeps its originals. The
// caller is a member the action resolved in the organization, or a support
// person filing for a caller: both reach only a report they filed there.

type ReportFileTarget = { reportId: string; kind: ProblemReportFileKind; fileName: string };

const refusal = writeRefusalFor(
  new Set([
    'report_not_found',
    'report_originals_deleted',
    'already_finalized',
    'screenshot_exists',
    'too_many_attachments',
  ]),
);

/** Signs the upload of one file of a report the filer filed. */
export async function issueProblemReportFileUploadTicket(
  filer: ReportFiler,
  input: ReportFileTarget & { mimeType: string; fileSizeBytes: number },
): Promise<ProblemReportFileUploadTicketResult> {
  const ruleFailure = uploadRuleFailure(
    PROBLEM_REPORT_FILE_RULES[input.kind],
    input.mimeType,
    input.fileSizeBytes,
  );
  if (ruleFailure) return { success: false, error: ruleFailure };
  const report = await readFilableReport(createSupabaseAdminClient(), filer, input.reportId);
  if (!report.success) return report;

  const fileId = randomUUID();
  const path = problemReportFilePath({
    organizationId: filer.orgId,
    reportId: input.reportId,
    fileId,
    kind: input.kind,
  });
  try {
    const uploadUrl = await createSignedUploadUrl({
      organizationId: filer.orgId,
      path,
      contentType: input.mimeType,
    });
    return { success: true, ticket: { fileId, uploadUrl } };
  } catch (error) {
    logError('issueProblemReportFileUploadTicket: signing failed', error);
    return { success: false, error: 'ticket_failed' };
  }
}

/** Copies, checks and registers one uploaded file of a report the filer filed. */
export async function registerUploadedProblemReportFile(
  filer: ReportFiler,
  input: ReportFileTarget & { fileId: string },
): Promise<ActionResult> {
  const organizationId = filer.orgId;
  // The key is recomputed from the authorized organization, so no client
  // names an object of another organization or report.
  const path = problemReportFilePath({
    organizationId,
    reportId: input.reportId,
    fileId: input.fileId,
    kind: input.kind,
  });

  const admin = createSupabaseAdminClient();
  const report = await readFilableReport(admin, filer, input.reportId);
  if (!report.success) {
    // Only the filer's own report whose originals are gone discards the staged
    // bytes; a report the caller did not file never lets them touch a key.
    if (report.error === 'report_originals_deleted')
      await discardStorageObjects({ organizationId, paths: [uploadStagingPath(organizationId, path)] });
    return report;
  }
  // A retry whose answer got lost finds its own registration.
  const registered = await isRegisteredFile(admin, organizationId, input.reportId, input.fileId);
  if (registered === undefined) return { success: false, error: 'load_failed' };
  if (registered) return { success: false, error: 'already_finalized' };

  let copy;
  try {
    copy = await promoteUploadedObject({ organizationId, path });
  } catch (error) {
    logError('registerUploadedProblemReportFile: promotion failed', error);
    return { success: false, error: 'upload_failed' };
  }
  if (!copy.exists) return { success: false, error: 'file_missing' };
  const ruleFailure = uploadRuleFailure(
    PROBLEM_REPORT_FILE_RULES[input.kind],
    copy.contentType,
    copy.sizeBytes,
  );
  if (ruleFailure || copy.contentType === null || copy.sizeBytes === null) {
    await discardStorageObjects({ organizationId, paths: [copy.path] });
    return { success: false, error: ruleFailure ?? 'file_empty' };
  }

  const { error } = await admin.rpc(
    'register_problem_report_file',
    rpcArgs('register_problem_report_file', {
      p_actor_id: filer.userId,
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_file_id: input.fileId,
      p_kind: input.kind,
      p_storage_path: copy.path,
      p_file_name: input.fileName,
      p_mime_type: copy.contentType,
      p_size_bytes: copy.sizeBytes,
      p_max_attachments: PROBLEM_REPORT_MAX_ATTACHMENTS,
    }),
  );
  if (!error) return { success: true };
  // After an unknown outcome the copy stays: the registration may still commit.
  if (isConfirmedWriteRefusal(error)) await discardStorageObjects({ organizationId, paths: [copy.path] });
  return refusal(error, 'finalize_failed', 'registerUploadedProblemReportFile: registration failed');
}
