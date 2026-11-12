'use server';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import {
  createSignedUploadUrl,
  discardStorageObjects,
  promoteUploadedObject,
  uploadStagingPath,
} from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';
import { isRegisteredFile, problemReportFilePath, readFilableReport } from './reads';
import {
  createProblemReportFileUploadTicketInputSchema,
  finalizeProblemReportFileUploadInputSchema,
  type CreateProblemReportFileUploadTicketInput,
  type FinalizeProblemReportFileUploadInput,
} from './schemas';
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
// filed the report adds files, and only while it keeps its originals.

const INVALID_INPUT = { success: false, error: 'invalid_input' } as const;
const refusal = writeRefusalFor(
  new Set([
    'report_not_found',
    'report_originals_deleted',
    'already_finalized',
    'screenshot_exists',
    'too_many_attachments',
  ]),
);

/** Whether the type and size fit the file kind; the ticket and the stored copy are checked alike. */
function fileRuleFailure(
  kind: ProblemReportFileKind,
  mimeType: string | null,
  sizeBytes: number | null,
): 'file_type_not_allowed' | 'file_empty' | 'file_too_large' | null {
  const rule = PROBLEM_REPORT_FILE_RULES[kind];
  if (mimeType === null || !rule.mimeTypes.includes(mimeType)) return 'file_type_not_allowed';
  if (sizeBytes === null || sizeBytes <= 0) return 'file_empty';
  return sizeBytes > rule.maxSizeBytes ? 'file_too_large' : null;
}

export async function createProblemReportFileUploadTicket(
  rawInput: CreateProblemReportFileUploadTicketInput,
): Promise<ProblemReportFileUploadTicketResult> {
  const parsed = createProblemReportFileUploadTicketInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveActionContextFor(input.organizationId);
  if (!auth.success) return auth;

  const ruleFailure = fileRuleFailure(input.kind, input.mimeType, input.fileSizeBytes);
  if (ruleFailure) return { success: false, error: ruleFailure };
  const report = await readFilableReport(createSupabaseAdminClient(), auth.context, input.reportId);
  if (!report.success) return report;

  const fileId = randomUUID();
  const path = problemReportFilePath({
    organizationId: auth.context.orgId,
    reportId: input.reportId,
    fileId,
    kind: input.kind,
  });
  try {
    const uploadUrl = await createSignedUploadUrl({
      organizationId: auth.context.orgId,
      path,
      contentType: input.mimeType,
    });
    return { success: true, ticket: { fileId, uploadUrl } };
  } catch (error) {
    logError('createProblemReportFileUploadTicket: signing failed', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function finalizeProblemReportFileUpload(
  rawInput: FinalizeProblemReportFileUploadInput,
): Promise<ActionResult> {
  const parsed = finalizeProblemReportFileUploadInputSchema.safeParse(rawInput);
  if (!parsed.success) return INVALID_INPUT;
  const input = parsed.data;
  const auth = await resolveActionContextFor(input.organizationId);
  if (!auth.success) return auth;
  const organizationId = auth.context.orgId;
  // The key is recomputed from the authorized organization, so no client
  // names an object of another organization or report.
  const path = problemReportFilePath({
    organizationId,
    reportId: input.reportId,
    fileId: input.fileId,
    kind: input.kind,
  });

  const admin = createSupabaseAdminClient();
  const report = await readFilableReport(admin, auth.context, input.reportId);
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
    logError('finalizeProblemReportFileUpload: promotion failed', error);
    return { success: false, error: 'upload_failed' };
  }
  if (!copy.exists) return { success: false, error: 'file_missing' };
  const ruleFailure = fileRuleFailure(input.kind, copy.contentType, copy.sizeBytes);
  if (ruleFailure || copy.contentType === null || copy.sizeBytes === null) {
    await discardStorageObjects({ organizationId, paths: [copy.path] });
    return { success: false, error: ruleFailure ?? 'file_empty' };
  }

  const { error } = await admin.rpc(
    'register_problem_report_file',
    rpcArgs('register_problem_report_file', {
      p_actor_id: auth.context.userId,
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
  return refusal(error, 'finalize_failed', 'finalizeProblemReportFileUpload: registration failed');
}
