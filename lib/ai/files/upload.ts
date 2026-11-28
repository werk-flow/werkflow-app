import 'server-only';

import { randomUUID } from 'node:crypto';

import type { ActionResult } from '@/lib/action-result';
import type { ActionContext } from '@/lib/org/action-context';
import { AI_UPLOAD_LIMITS } from '@/lib/ai/limits';
import { isAiReleasedFor } from '@/lib/ai/release-gate';
import { logError } from '@/lib/logging';
import {
  createSignedUploadUrl,
  discardStorageObjects,
  promoteUploadedObject,
  readStorageObject,
} from '@/lib/storage/r2';
import { type UploadRule, uploadRuleFailure } from '@/lib/storage/upload-rules';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { isConfirmedWriteRefusal, writeRefusalFor } from '@/lib/supabase/write-refusal';
import { hasSignatureOf } from './file-signature';
import { countPdfPages } from './pdf-pages';
import type { AiFileFinalizeResult, AiFileUploadTicketResult, AiUploadedFile } from './types';

// A file or phone photo a person adds to their next WerkFlow KI message
// (docs/technical/document-storage-and-access.md, "KI files"). The ticket signs
// a PUT for a staging key, the browser moves the bytes, and the finalize copies
// them to a key of its own, checks type, size, leading bytes and a PDF's
// declared pages on the copy, and registers it unattached. The key holds the
// uploader, so only their own session finds the staged bytes; it holds no file
// name.

type Caller = Pick<ActionContext, 'orgId' | 'userId'>;

const RULE: UploadRule = {
  mimeTypes: AI_UPLOAD_LIMITS.mimeTypes,
  maxSizeBytes: AI_UPLOAD_LIMITS.maxFileBytes,
};

const refusal = writeRefusalFor(new Set(['already_finalized', 'too_many_unsent_files']));

/** The key of one upload: the organization, the uploader, the file. */
function aiFilePath(caller: Caller, fileId: string): string {
  return `${caller.orgId}/ki/${caller.userId}/${fileId}/datei`;
}

/** Signs the upload of one file for the caller's next message. */
export async function issueAiFileUploadTicket(
  caller: Caller,
  input: { mimeType: string; fileSizeBytes: number },
): Promise<AiFileUploadTicketResult> {
  if (!isAiReleasedFor(caller.orgId)) return { success: false, error: 'not_released' };
  const ruleFailure = uploadRuleFailure(RULE, input.mimeType, input.fileSizeBytes);
  if (ruleFailure) return { success: false, error: ruleFailure };
  const fileId = randomUUID();
  try {
    const uploadUrl = await createSignedUploadUrl({
      organizationId: caller.orgId,
      path: aiFilePath(caller, fileId),
      contentType: input.mimeType,
      // The PUT carries exactly the size the cap checked, so storage takes no larger body.
      contentLength: input.fileSizeBytes,
    });
    return { success: true, fileId, uploadUrl };
  } catch (error) {
    logError('issueAiFileUploadTicket: signing failed', error);
    return { success: false, error: 'ticket_failed' };
  }
}

/**
 * Why the stored copy is refused, or its page count: null for an image and for
 * a PDF whose page tree the counter cannot follow. The cap is advisory
 * (lib/ai/files/pdf-pages.ts); a file whose bytes are not of its type is refused.
 */
async function checkContent(
  caller: Caller,
  path: string,
  mimeType: string,
): Promise<{ pages: number | null } | { error: string }> {
  const bytes = await readStorageObject({ organizationId: caller.orgId, path });
  if (!hasSignatureOf(bytes, mimeType)) return { error: 'file_unreadable' };
  const pages = mimeType === 'application/pdf' ? countPdfPages(bytes) : null;
  return pages !== null && pages > AI_UPLOAD_LIMITS.maxPdfPages
    ? { error: 'file_too_many_pages' }
    : { pages };
}

/** The caller's registered file under the id, when a finalize already registered it. */
async function readRegistered(caller: Caller, fileId: string): Promise<AiUploadedFile | null | 'failed'> {
  const { data, error } = await createSupabaseAdminClient()
    .from('ai_thread_files')
    .select('id, file_name, mime_type, size_bytes, page_count')
    .eq('organization_id', caller.orgId)
    .eq('user_id', caller.userId)
    .eq('id', fileId)
    .maybeSingle();
  if (error) {
    logError('registerUploadedAiFile: registration read failed', error);
    return 'failed';
  }
  return data
    ? {
        fileId: data.id,
        name: data.file_name,
        mimeType: data.mime_type,
        sizeBytes: data.size_bytes,
        pages: data.page_count,
      }
    : null;
}

/**
 * Copies, checks and registers one upload of the caller. A retry whose answer
 * got lost finds its registration and answers with it.
 */
export async function registerUploadedAiFile(
  caller: Caller,
  input: { fileId: string; fileName: string },
): Promise<AiFileFinalizeResult> {
  const organizationId = caller.orgId;
  const registered = await readRegistered(caller, input.fileId);
  if (registered === 'failed') return { success: false, error: 'load_failed' };
  if (registered) return { success: true, file: registered };

  let copy;
  try {
    // The key is recomputed from the session, so no client names another person's or organization's bytes.
    copy = await promoteUploadedObject({ organizationId, path: aiFilePath(caller, input.fileId) });
  } catch (error) {
    logError('registerUploadedAiFile: promotion failed', error);
    return { success: false, error: 'upload_failed' };
  }
  if (!copy.exists) return { success: false, error: 'file_missing' };
  const discard = () => discardStorageObjects({ organizationId, paths: [copy.path] });
  const ruleFailure = uploadRuleFailure(RULE, copy.contentType, copy.sizeBytes);
  if (ruleFailure || copy.contentType === null || copy.sizeBytes === null) {
    await discard();
    return { success: false, error: ruleFailure ?? 'file_empty' };
  }
  let pages;
  try {
    pages = await checkContent(caller, copy.path, copy.contentType);
  } catch (error) {
    // No row references the copy yet, so it goes; the person uploads the file again.
    logError('registerUploadedAiFile: content check failed', error);
    await discard();
    return { success: false, error: 'upload_failed' };
  }
  if ('error' in pages) {
    await discard();
    return { success: false, error: pages.error };
  }

  const file: AiUploadedFile = {
    fileId: input.fileId,
    name: input.fileName,
    mimeType: copy.contentType,
    sizeBytes: copy.sizeBytes,
    pages: pages.pages,
  };
  const { error } = await createSupabaseAdminClient().rpc(
    'register_ai_thread_file',
    rpcArgs('register_ai_thread_file', {
      p_organization_id: organizationId,
      p_user_id: caller.userId,
      p_file_id: file.fileId,
      p_storage_path: copy.path,
      p_file_name: file.name,
      p_mime_type: file.mimeType,
      p_size_bytes: file.sizeBytes,
      p_page_count: file.pages,
      p_max_unattached: AI_UPLOAD_LIMITS.maxUnsentFiles,
    }),
  );
  if (!error) return { success: true, file };
  // After an unknown outcome the copy stays: the registration may still commit.
  if (isConfirmedWriteRefusal(error)) await discard();
  return refusal(error, 'finalize_failed', 'registerUploadedAiFile: registration failed');
}

/** Removes one of the caller's unsent uploads; its object is queued for the purge. */
export async function discardUploadedAiFile(caller: Caller, fileId: string): Promise<ActionResult> {
  const { error } = await createSupabaseAdminClient().rpc('discard_ai_thread_file', {
    p_organization_id: caller.orgId,
    p_user_id: caller.userId,
    p_file_id: fileId,
  });
  if (!error) return { success: true };
  logError('discardUploadedAiFile: discard failed', error);
  return { success: false, error: 'discard_failed' };
}
