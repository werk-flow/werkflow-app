import 'server-only';

import { revalidatePath } from 'next/cache';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { discardStorageObjects, headStorageObject } from '@/lib/storage/r2';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import type { AuthorizedDocumentContext } from './access';
import { firstAvailableName } from './names';
import { DOCUMENT_MAX_FILE_SIZE_BYTES } from './types';

// Server helpers that the document writes share: the free sibling name, the
// uploaded-object check, the failure of a write function and the cache
// revalidation. They take the context of an authorized caller in actions.ts.

type SupabaseAdmin = AuthorizedDocumentContext['admin'];

export function revalidateDocuments(): void {
  revalidatePath('/dokumente');
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/mitarbeiter', 'layout');
  revalidatePath('/kunden', 'layout');
  revalidatePath('/service', 'layout');
}

/**
 * The failure of a document write function: the refusal code it raised when
 * the action knows that code, the fallback otherwise. The failure is logged.
 */
export function documentWriteFailure(
  label: string,
  error: { code?: string; message?: string } | null,
  knownCodes: readonly string[],
  fallback: string,
): ActionFailure {
  logError(label, error);
  const message = error?.message ?? '';
  return { success: false, error: knownCodes.includes(message) ? message : fallback };
}

export async function getAvailableDisplayName({
  admin,
  orgId,
  folderId,
  preferredName,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  folderId?: string | null | undefined;
  preferredName: string;
}): Promise<string> {
  const { data, error } = await readCompleteRows((from, to) => {
    const query = admin
      .from('documents')
      .select('display_name')
      .eq('organization_id', orgId)
      .is('deleted_at', null);
    return (folderId ? query.eq('folder_id', folderId) : query.is('folder_id', null))
      .order('id')
      .range(from, to);
  }, LIST_ROW_CAP);
  if (error) logReadFailure('getAvailableDisplayName: sibling names failed', error);
  return firstAvailableName({
    preferredName: preferredName.trim() || 'Dokument',
    takenNames: new Set((data ?? []).map((row) => row.display_name)),
    keepExtension: true,
  });
}

export async function getAvailableFolderName({
  admin,
  orgId,
  parentFolderId,
  preferredName,
}: {
  admin: SupabaseAdmin;
  orgId: string;
  parentFolderId?: string | null | undefined;
  preferredName: string;
}): Promise<string> {
  const { data, error } = await readCompleteRows((from, to) => {
    const query = admin
      .from('document_folders')
      .select('name')
      .eq('organization_id', orgId)
      .is('deleted_at', null);
    return (
      parentFolderId ? query.eq('parent_folder_id', parentFolderId) : query.is('parent_folder_id', null)
    )
      .order('id')
      .range(from, to);
  }, LIST_ROW_CAP);
  if (error) logReadFailure('getAvailableFolderName: sibling names failed', error);
  return firstAvailableName({
    preferredName: preferredName.trim() || 'Ordner',
    takenNames: new Set((data ?? []).map((row) => row.name)),
    keepExtension: false,
  });
}

/**
 * Checks the object the browser uploaded to a signed URL: it exists, is not
 * empty and stays within the size limit. A rejected object is discarded.
 */
export async function verifyUploadedObject({
  organizationId,
  storagePath,
  failureLabel,
}: {
  organizationId: string;
  storagePath: string;
  failureLabel: string;
}): Promise<ActionResult<{ sizeBytes: number; contentType: string }>> {
  let head;
  try {
    head = await headStorageObject({ organizationId, path: storagePath });
  } catch (error) {
    logError(failureLabel, error);
    return { success: false, error: 'upload_failed' };
  }

  if (!head.exists) {
    return { success: false, error: 'file_missing' };
  }

  if (!head.sizeBytes || head.sizeBytes <= 0) {
    await discardStorageObjects({ organizationId, paths: [storagePath] });
    return { success: false, error: 'file_empty' };
  }

  if (head.sizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    await discardStorageObjects({ organizationId, paths: [storagePath] });
    return { success: false, error: 'file_too_large' };
  }

  return {
    success: true,
    sizeBytes: head.sizeBytes,
    contentType: head.contentType || 'application/octet-stream',
  };
}
