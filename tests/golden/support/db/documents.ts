import { randomUUID } from 'node:crypto';
import { buildDocumentStoragePath } from '../../../../lib/documents/storage-path';
import { putStorageObject } from '../../../../lib/storage/r2';
import { rpcArgs } from '../../../../lib/supabase/rpc-args';
import { createAdminClient } from './shared';

// The UI never exposes the object key behind an uploaded document; the canary
// download round-trip needs it to prove the bytes actually landed in R2.
export async function getDocumentStoragePathByName(orgId: string, displayName: string): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('documents')
    .select('storage_path')
    .eq('organization_id', orgId)
    // The stored display name keeps the file extension; callers pass the same
    // extension-less name the UI assertions use.
    .ilike('display_name', `${displayName}%`)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`No document named ${displayName} found: ${error?.message}`);
  }
  return data.storage_path as string;
}

// A valid one-pixel PNG: the viewer renders it as an image preview.
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Stores a small PNG in object storage and registers it through the same
 * database function a finished upload calls, so the document carries its
 * version, audit event and optional job link. Returns the document id.
 */
export async function seedStoredImageDocument(input: {
  orgId: string;
  actorId: string;
  displayName: string;
  jobId?: string;
}): Promise<string> {
  const documentId = randomUUID();
  const storagePath = buildDocumentStoragePath({
    organizationId: input.orgId,
    documentId,
    fileName: input.displayName,
  });
  await putStorageObject({
    organizationId: input.orgId,
    path: storagePath,
    body: ONE_PIXEL_PNG,
    contentType: 'image/png',
  });
  await createAdminClient()
    .rpc(
      'finalize_document_upload',
      rpcArgs('finalize_document_upload', {
        p_actor_id: input.actorId,
        p_organization_id: input.orgId,
        p_document_id: documentId,
        p_folder_id: null,
        p_storage_path: storagePath,
        p_original_file_name: input.displayName,
        p_display_name: input.displayName,
        p_category: 'photo',
        p_mime_type: 'image/png',
        p_size_bytes: ONE_PIXEL_PNG.byteLength,
        p_link_kind: input.jobId ? 'job' : null,
        p_link_target_id: input.jobId ?? null,
      }),
    )
    .throwOnError();
  return documentId;
}
