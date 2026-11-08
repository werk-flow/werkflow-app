'use server';

import { randomUUID } from 'crypto';
import { logError } from '@/lib/logging';
import { createSignedUploadUrl, discardStorageObjects } from '@/lib/storage/r2';
import { isConfirmedWriteRefusal } from '@/lib/supabase/write-refusal';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import {
  authorizeDocumentUploadTarget,
  getAuthorizedDocumentContext,
  getVersionableDocument,
  normalizeUploadTarget,
  type NormalizedUploadTarget,
} from './access';
import {
  createDocumentUploadTicketInputSchema,
  createDocumentVersionUploadTicketInputSchema,
  finalizeDocumentUploadInputSchema,
  finalizeDocumentVersionUploadInputSchema,
  INVALID_INPUT,
  parseActionInput,
  type CreateDocumentUploadTicketInput,
  type CreateDocumentVersionUploadTicketInput,
  type FinalizeDocumentUploadInput,
  type FinalizeDocumentVersionUploadInput,
} from './action-schemas';
import { inferDocumentCategory } from './category-inference';
import { hydrateWrittenDocument } from './hydration';
import { readDocumentStoragePath } from './reads';
import { buildDocumentStoragePath, buildDocumentVersionStoragePath } from './storage-path';
import {
  DOCUMENT_MAX_FILE_SIZE_BYTES,
  DOCUMENT_STORAGE_BUCKET,
  toDocumentCategory,
  type DocumentCategory,
  type DocumentResult,
  type DocumentUploadTicketResult,
  type DocumentVersion,
  type DocumentVersionUploadTicketResult,
  type VersionResult,
} from './types';
import {
  documentWriteFailure,
  getAvailableDisplayName,
  revalidateDocuments,
  acceptUploadedObject,
  discardStagedUpload,
} from './write-support';

// A sent category maps to its known value or 'other'; only a missing one falls back to inference.
function parseDocumentCategory(value: string | null): DocumentCategory | null {
  return value === null ? null : toDocumentCategory(value);
}

/**
 * Removes a finalize's own copy after the database refused its registration.
 * After an unknown outcome the copy stays: the registration may still commit.
 */
async function discardRefusedCopy(
  organizationId: string,
  storagePath: string,
  error: { code?: string } | null,
): Promise<void> {
  if (isConfirmedWriteRefusal(error)) await discardStorageObjects({ organizationId, paths: [storagePath] });
}

const UPLOAD_LINK_KINDS = [
  ['job', 'jobId'],
  ['project', 'projectId'],
  ['client', 'clientId'],
  ['employee', 'employeeId'],
  ['request', 'requestId'],
  ['equipment', 'equipmentId'],
  ['service_case', 'serviceCaseId'],
  ['maintenance_coverage', 'maintenanceCoverageId'],
] as const;

/** The one record an upload links to, or null for a library upload. */
function uploadLinkTarget(target: NormalizedUploadTarget): { kind: string; id: string } | null {
  for (const [kind, key] of UPLOAD_LINK_KINDS) {
    const id = target[key];
    if (id) return { kind, id };
  }
  return null;
}

export async function createDocumentUploadTicket(
  rawInput: CreateDocumentUploadTicketInput,
): Promise<DocumentUploadTicketResult> {
  const input = parseActionInput(createDocumentUploadTicketInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  if (input.fileSizeBytes <= 0) {
    return { success: false, error: 'file_empty' };
  }

  if (input.fileSizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'file_too_large' };
  }

  const target = normalizeUploadTarget(input);
  const access = await authorizeDocumentUploadTarget(auth.context, target);
  if (!access.success) return access;

  const originalFileName = input.fileName.trim() || 'Dokument';
  const documentId = randomUUID();
  const storagePath = buildDocumentStoragePath({
    organizationId: auth.context.orgId,
    documentId,
    fileName: originalFileName,
  });

  try {
    const uploadUrl = await createSignedUploadUrl({
      path: storagePath,
      organizationId: auth.context.orgId,
      contentType: input.mimeType || 'application/octet-stream',
    });

    return { success: true, ticket: { documentId, storagePath, uploadUrl } };
  } catch (error) {
    logError('Failed to create document upload ticket', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function finalizeDocumentUpload(rawInput: FinalizeDocumentUploadInput): Promise<DocumentResult> {
  const input = parseActionInput(finalizeDocumentUploadInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const originalFileName = input.fileName.trim() || 'Dokument';
  // The upload's path is recomputed server-side from the authenticated org and
  // the document id, so a client can never register a foreign object key.
  const uploadPath = buildDocumentStoragePath({
    organizationId: auth.context.orgId,
    documentId: input.documentId,
    fileName: originalFileName,
  });

  // Only a completed read proves the upload unregistered. A finalize that read
  // before a concurrent one committed still copies only to a key of its own.
  const registeredPath = await readDocumentStoragePath(auth.context, input.documentId);
  if (registeredPath === undefined) return { success: false, error: 'load_failed' };
  if (registeredPath) return { success: false, error: 'already_finalized' };

  const target = normalizeUploadTarget(input);
  const access = await authorizeDocumentUploadTarget(auth.context, target);
  if (!access.success) {
    await discardStagedUpload(auth.context.orgId, uploadPath);
    return access;
  }

  const head = await acceptUploadedObject({
    organizationId: auth.context.orgId,
    storagePath: uploadPath,
    failureLabel: 'Failed to verify uploaded document object',
  });
  if (!head.success) return head;
  const { contentType, storagePath } = head;
  const category =
    parseDocumentCategory(input.category ?? null) ??
    inferDocumentCategory({
      fileName: originalFileName,
      mimeType: contentType,
    });
  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: target.folderId,
    preferredName: originalFileName,
  });

  // One transaction writes the document, its link and their audit events.
  const linkTarget = uploadLinkTarget(target);
  const { data: documentRow, error } = await auth.context.admin.rpc(
    'finalize_document_upload',
    rpcArgs('finalize_document_upload', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_document_id: input.documentId,
      p_folder_id: target.folderId,
      p_storage_path: storagePath,
      p_original_file_name: originalFileName,
      p_display_name: displayName,
      p_category: category,
      p_mime_type: contentType,
      p_size_bytes: head.sizeBytes,
      p_link_kind: linkTarget?.kind ?? null,
      p_link_target_id: linkTarget?.id ?? null,
    }),
  );
  if (error || !documentRow) {
    const failure = documentWriteFailure(
      'Failed to finalize document upload',
      error,
      [
        'already_finalized',
        'link_failed',
        'folder_not_found',
        'invalid_target',
        'not_a_member',
        'not_authorized',
      ],
      'create_failed',
    );
    // Only this finalize wrote its copy; a concurrent one that committed registered its own.
    await discardRefusedCopy(auth.context.orgId, storagePath, error);
    return failure;
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context, documentRow);
}

export async function createDocumentVersionUploadTicket(
  rawInput: CreateDocumentVersionUploadTicketInput,
): Promise<DocumentVersionUploadTicketResult> {
  const input = parseActionInput(createDocumentVersionUploadTicketInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getVersionableDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  if (input.fileSizeBytes <= 0) {
    return { success: false, error: 'file_empty' };
  }

  if (input.fileSizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    return { success: false, error: 'file_too_large' };
  }

  const nextVersionNumber = existing.document.current_version_number + 1;
  const storagePath = buildDocumentVersionStoragePath({
    organizationId: auth.context.orgId,
    documentId: existing.document.id,
    versionNumber: nextVersionNumber,
    fileName: input.fileName.trim() || 'Dokument',
  });

  try {
    const uploadUrl = await createSignedUploadUrl({
      path: storagePath,
      organizationId: auth.context.orgId,
      contentType: input.mimeType || 'application/octet-stream',
    });

    return {
      success: true,
      ticket: {
        documentId: existing.document.id,
        versionNumber: nextVersionNumber,
        storagePath,
        uploadUrl,
      },
    };
  } catch (error) {
    logError('Failed to create version upload ticket', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function finalizeDocumentVersionUpload(
  rawInput: FinalizeDocumentVersionUploadInput,
): Promise<VersionResult> {
  const input = parseActionInput(finalizeDocumentVersionUploadInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  // The ticket's key, recomputed from the authenticated organization: a
  // client never names a foreign key. Finalize promotes its staging object.
  const originalFileName = input.fileName.trim() || 'Dokument';
  const ticketPath = buildDocumentVersionStoragePath({
    organizationId: auth.context.orgId,
    documentId: input.documentId,
    versionNumber: input.versionNumber,
    fileName: originalFileName,
  });

  const existing = await getVersionableDocument(auth.context, input.documentId);
  if (!existing.success) {
    // A manager filed the document after this ticket, so no finalize of the
    // upload can succeed. Only its staging object goes, never a registered key.
    if (existing.error === 'document_filed') await discardStagedUpload(auth.context.orgId, ticketPath);
    return existing;
  }

  const nextVersionNumber = existing.document.current_version_number + 1;
  if (input.versionNumber !== nextVersionNumber) {
    // Another version landed between ticket and finalize; the upload must not
    // become the current file. It still sits at its staging key, which no
    // archived version shares.
    await discardStagedUpload(auth.context.orgId, ticketPath);
    return { success: false, error: 'version_conflict' };
  }

  const head = await acceptUploadedObject({
    organizationId: auth.context.orgId,
    storagePath: ticketPath,
    failureLabel: 'Failed to verify uploaded version object',
  });
  if (!head.success) return head;
  const { contentType, storagePath } = head;

  // One transaction archives the current file, makes the upload current and records it.
  const { data: updatedDocument, error } = await auth.context.admin.rpc('finalize_document_version_upload', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_expected_version_number: existing.document.current_version_number,
    p_storage_path: storagePath,
    p_original_file_name: originalFileName,
    p_mime_type: contentType,
    p_size_bytes: head.sizeBytes,
  });
  if (error || !updatedDocument) {
    const failure = documentWriteFailure(
      'Failed to store the new document version',
      error,
      ['version_conflict', 'document_not_found', 'versioning_not_supported', 'document_filed'],
      'version_failed',
    );
    // Only this finalize wrote its copy; a concurrent one that committed made its own current.
    await discardRefusedCopy(auth.context.orgId, storagePath, error);
    return failure;
  }

  const version: DocumentVersion = {
    id: 'latest',
    organizationId: auth.context.orgId,
    documentId: existing.document.id,
    versionNumber: nextVersionNumber,
    storageBucket: DOCUMENT_STORAGE_BUCKET,
    storagePath,
    originalFileName,
    mimeType: contentType,
    sizeBytes: head.sizeBytes,
    uploadedBy: auth.context.userId,
    createdAt: updatedDocument.updated_at,
    uploader: null,
  };

  revalidateDocuments();
  return { success: true, version };
}
