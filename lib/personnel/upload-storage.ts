import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import {
  discardStorageObjects,
  headStorageObject,
  promoteUploadedObject,
  uploadStagingPath,
  type StorageObjectHead,
} from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';

// The storage steps of a protected personnel upload. The actions in
// lifecycle-actions.ts authorize the caller and verify the cleanup token first.

type PersonnelUpload = { admin: AdminClient; organizationId: string; storagePath: string };

/**
 * The document that owns the upload's key, or `undefined` when the read
 * failed: only a completed read proves that no document owns the object.
 */
export async function readPersonnelUploadOwner(
  { admin, organizationId, storagePath }: PersonnelUpload,
  label: string,
): Promise<{ id: string } | null | undefined> {
  const { data, error } = await loggedRead(
    label,
    admin
      .from('documents')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('storage_path', storagePath)
      .maybeSingle(),
  );
  return error ? undefined : data;
}

/**
 * The object a finalize registers. A first finalize copies the staging key;
 * a replay of a registered upload reads the registered object and copies
 * nothing, so a signed URL that is still valid cannot replace its bytes.
 */
export async function acceptPersonnelUpload(
  upload: PersonnelUpload,
): Promise<ActionResult<{ sizeBytes: number; contentType: string | null }>> {
  const owner = await readPersonnelUploadOwner(upload, 'acceptPersonnelUpload: documents read failed');
  if (owner === undefined) return { success: false, error: 'load_failed' };
  const scope = { organizationId: upload.organizationId, path: upload.storagePath };
  let head: StorageObjectHead;
  try {
    head = await (owner ? headStorageObject(scope) : promoteUploadedObject(scope));
  } catch (error) {
    logError('acceptPersonnelUpload: storage failed', error);
    return { success: false, error: 'upload_failed' };
  }
  if (!head.exists || !head.sizeBytes || head.sizeBytes <= 0)
    return { success: false, error: 'file_missing' };
  return { success: true, sizeBytes: head.sizeBytes, contentType: head.contentType };
}

/** Removes an unregistered upload: its staging object and a copy a failed finalize left. */
export async function discardPersonnelUpload({
  organizationId,
  storagePath,
}: PersonnelUpload): Promise<void> {
  await discardStorageObjects({
    organizationId,
    paths: [uploadStagingPath(organizationId, storagePath), storagePath],
  });
}
