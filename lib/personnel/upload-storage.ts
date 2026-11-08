import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { DOCUMENT_MAX_FILE_SIZE_BYTES } from '@/lib/documents/types';
import { logError } from '@/lib/logging';
import {
  discardStorageObjects,
  promoteUploadedObject,
  uploadStagingPath,
  type PromotedUpload,
} from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';
import { isConfirmedWriteRefusal } from '@/lib/supabase/write-refusal';

// The storage steps of a protected personnel upload. The actions in
// lifecycle-actions.ts authorize the caller and verify the cleanup token first.
// A finalize copies the staged upload to a key of its own, so no other
// finalize and no cleanup ever writes or removes the key a document registered.

/** `storagePath` is the ticket's path: its staging key holds the browser's upload. */
type PersonnelUpload = {
  admin: AdminClient;
  organizationId: string;
  documentId: string;
  storagePath: string;
};

/**
 * The registered document of the upload, or `undefined` when the read failed:
 * only a completed read proves that no document registered it.
 */
export async function readPersonnelUploadOwner(
  { admin, organizationId, documentId }: PersonnelUpload,
  label: string,
): Promise<{ size_bytes: number; mime_type: string | null } | null | undefined> {
  const { data, error } = await loggedRead(
    label,
    admin
      .from('documents')
      .select('size_bytes, mime_type')
      .eq('organization_id', organizationId)
      .eq('id', documentId)
      .maybeSingle(),
  );
  return error ? undefined : data;
}

/**
 * The object a finalize registers. A first finalize copies the staging key to
 * a key of its own and checks it; a rejected copy is discarded. A replay of a
 * registered upload copies nothing: the database function answers it from its
 * operation record, so the ticket's path stands in for the key (`copied` is false).
 */
export async function acceptPersonnelUpload(
  upload: PersonnelUpload,
): Promise<
  ActionResult<{ storagePath: string; copied: boolean; sizeBytes: number; contentType: string | null }>
> {
  const owner = await readPersonnelUploadOwner(upload, 'acceptPersonnelUpload: documents read failed');
  if (owner === undefined) return { success: false, error: 'load_failed' };
  const { organizationId } = upload;
  if (owner) {
    return {
      success: true,
      storagePath: upload.storagePath,
      copied: false,
      sizeBytes: owner.size_bytes,
      contentType: owner.mime_type,
    };
  }
  let head: PromotedUpload;
  try {
    head = await promoteUploadedObject({ organizationId, path: upload.storagePath });
  } catch (error) {
    logError('acceptPersonnelUpload: storage failed', error);
    return { success: false, error: 'upload_failed' };
  }
  const reject = async (error: 'file_missing' | 'file_too_large') => {
    await discardStorageObjects({ organizationId, paths: [head.path] });
    return { success: false, error } as const;
  };
  if (!head.exists || !head.sizeBytes || head.sizeBytes <= 0) return reject('file_missing');
  if (head.sizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) return reject('file_too_large');
  return {
    success: true,
    storagePath: head.path,
    copied: true,
    sizeBytes: head.sizeBytes,
    contentType: head.contentType,
  };
}

/**
 * Removes a finalize's own copy after the database refused its registration.
 * After an unknown outcome the copy stays, since the registration may still
 * commit; a replay copied nothing.
 */
export async function discardRefusedPersonnelCopy(
  { organizationId }: PersonnelUpload,
  accepted: { storagePath: string; copied: boolean },
  error: { code?: string } | null,
): Promise<void> {
  if (!accepted.copied || !isConfirmedWriteRefusal(error)) return;
  await discardStorageObjects({ organizationId, paths: [accepted.storagePath] });
}

/** Removes an unregistered upload's staging object; a finalize removes its own copy. */
export async function discardPersonnelUpload({
  organizationId,
  storagePath,
}: PersonnelUpload): Promise<void> {
  await discardStorageObjects({ organizationId, paths: [uploadStagingPath(organizationId, storagePath)] });
}
