import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { DOCUMENT_MAX_FILE_SIZE_BYTES } from '@/lib/documents/types';
import { logError } from '@/lib/logging';
import {
  discardStorageObjects,
  headStorageObject,
  promoteUploadedObject,
  uploadStagingPath,
  type PromotedUpload,
} from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';

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
 * The registered document of the upload with its key, or `undefined` when the
 * read failed: only a completed read proves that no document registered it.
 */
export async function readPersonnelUploadOwner(
  { admin, organizationId, documentId }: PersonnelUpload,
  label: string,
): Promise<{ id: string; storage_path: string } | null | undefined> {
  const { data, error } = await loggedRead(
    label,
    admin
      .from('documents')
      .select('id, storage_path')
      .eq('organization_id', organizationId)
      .eq('id', documentId)
      .maybeSingle(),
  );
  return error ? undefined : data;
}

/**
 * The object a finalize registers. A first finalize copies the staging key to
 * a key of its own; a replay of a registered upload reads the registered
 * object and copies nothing. A rejected copy is discarded.
 */
export async function acceptPersonnelUpload(
  upload: PersonnelUpload,
): Promise<ActionResult<{ storagePath: string; sizeBytes: number; contentType: string | null }>> {
  const owner = await readPersonnelUploadOwner(upload, 'acceptPersonnelUpload: documents read failed');
  if (owner === undefined) return { success: false, error: 'load_failed' };
  const { organizationId } = upload;
  let head: PromotedUpload;
  try {
    head = owner
      ? {
          ...(await headStorageObject({ organizationId, path: owner.storage_path })),
          path: owner.storage_path,
        }
      : await promoteUploadedObject({ organizationId, path: upload.storagePath });
  } catch (error) {
    logError('acceptPersonnelUpload: storage failed', error);
    return { success: false, error: 'upload_failed' };
  }
  const reject = async (error: 'file_missing' | 'file_too_large') => {
    if (!owner) await discardStorageObjects({ organizationId, paths: [head.path] });
    return { success: false, error } as const;
  };
  if (!head.exists || !head.sizeBytes || head.sizeBytes <= 0) return reject('file_missing');
  if (head.sizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) return reject('file_too_large');
  return { success: true, storagePath: head.path, sizeBytes: head.sizeBytes, contentType: head.contentType };
}

/**
 * Removes a finalize's copy that its document did not register. After a
 * refused registration, a document that is missing or holds another key
 * proves it. After an accepted one only another key does: the function
 * replays a concurrent finalize that committed first and returns its
 * document. A failed read keeps the copy.
 */
export async function discardUnregisteredPersonnelCopy(
  upload: PersonnelUpload,
  copyPath: string,
  registration: 'accepted' | 'refused',
): Promise<void> {
  const owner = await readPersonnelUploadOwner(
    upload,
    'discardUnregisteredPersonnelCopy: documents read failed',
  );
  if (owner === undefined || owner?.storage_path === copyPath) return;
  if (owner === null && registration === 'accepted') return;
  await discardStorageObjects({ organizationId: upload.organizationId, paths: [copyPath] });
}

/** Removes an unregistered upload's staging object; a finalize removes its own copy. */
export async function discardPersonnelUpload({
  organizationId,
  storagePath,
}: PersonnelUpload): Promise<void> {
  await discardStorageObjects({ organizationId, paths: [uploadStagingPath(organizationId, storagePath)] });
}
