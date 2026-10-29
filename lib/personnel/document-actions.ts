'use server';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { loggedRead } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { resolveSelfServiceContextFor } from '@/lib/org/self-service-context';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { getSupabaseSecretKey } from '@/lib/env/server';
import { createSignedDownloadUrl, createSignedUploadUrl, discardStorageObjects } from '@/lib/storage/r2';
import { acceptPersonnelUpload, discardPersonnelUpload, readPersonnelUploadOwner } from './upload-storage';
import { DOCUMENT_MAX_FILE_SIZE_BYTES, DOCUMENT_STORAGE_BUCKET } from '@/lib/documents/types';
import { buildDocumentStoragePath } from '@/lib/documents/storage-path';
import {
  personnelDocumentUploadInputSchema,
  personnelDocumentUploadCleanupInputSchema,
  personnelDocumentUploadTicketInputSchema,
  personnelDocumentReleaseInputSchema,
  type PersonnelDocumentAccessClass,
} from './lifecycle';
import {
  getSelfContext,
  hashRequest,
  lifecycleFailureCode,
  requireManagerRecord,
  revalidatePersonnel,
  type LifecycleResult,
} from './lifecycle-action-context';
import { documentFileSchema } from './lifecycle-rows';

const signedDocumentFileSchema = documentFileSchema.extend({
  organization_id: z.string(),
  storage_path: z.string(),
});

// Covers the 25-minute browser upload timeout plus finalize and cleanup retries.
const UPLOAD_CLEANUP_TOKEN_TTL_MS = 45 * 60 * 1000;

const uploadCleanupTokenPayloadSchema = z.object({
  actorId: z.string(),
  organizationId: z.string(),
  employeeRecordId: z.string(),
  documentId: z.string(),
  fileName: z.string(),
  accessClass: personnelDocumentUploadInputSchema.shape.accessClass,
  operationId: z.string(),
  expiresAt: z.number(),
});
type UploadCleanupTokenPayload = z.infer<typeof uploadCleanupTokenPayloadSchema>;

function uploadCleanupTokenSecret(): Buffer {
  const secret = getSupabaseSecretKey();
  return createHmac('sha256', secret).update('werkflow:p1-24-upload-cleanup:v1').digest();
}

function createUploadCleanupToken(payload: Omit<UploadCleanupTokenPayload, 'expiresAt'>): string {
  const encoded = Buffer.from(
    JSON.stringify({
      ...payload,
      expiresAt: Date.now() + UPLOAD_CLEANUP_TOKEN_TTL_MS,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', uploadCleanupTokenSecret()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function isValidUploadCleanupToken(
  token: string,
  expected: Omit<UploadCleanupTokenPayload, 'expiresAt'>,
): boolean {
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra) return false;
  const actualSignature = createHmac('sha256', uploadCleanupTokenSecret()).update(encoded).digest();
  const suppliedSignature = Buffer.from(signature, 'base64url');
  if (
    suppliedSignature.length !== actualSignature.length ||
    !timingSafeEqual(suppliedSignature, actualSignature)
  )
    return false;
  try {
    const parsedPayload = uploadCleanupTokenPayloadSchema.safeParse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')),
    );
    if (!parsedPayload.success) return false;
    const payload = parsedPayload.data;
    return (
      payload.expiresAt >= Date.now() &&
      payload.actorId === expected.actorId &&
      payload.organizationId === expected.organizationId &&
      payload.employeeRecordId === expected.employeeRecordId &&
      payload.documentId === expected.documentId &&
      payload.fileName === expected.fileName &&
      payload.accessClass === expected.accessClass &&
      payload.operationId === expected.operationId
    );
  } catch {
    return false;
  }
}

export async function setPersonnelDocumentRelease(
  input: unknown,
): Promise<LifecycleResult<{ releaseId: string }>> {
  const parsed = personnelDocumentReleaseInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const context = await requireManagerRecord(parsed.data.employeeRecordId);
  if (!context.success) return context;
  const request = parsed.data;
  const { data, error } = await context.admin.rpc(
    'set_personnel_document_release',
    rpcArgs('set_personnel_document_release', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_personnel_document_id: request.personnelDocumentId,
      p_document_version_number: request.documentVersionNumber,
      p_release: request.release,
      p_reason: request.reason,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) return { success: false, error: lifecycleFailureCode(error) };
  revalidatePersonnel();
  return { success: true, data: { releaseId: data } };
}

type PersonnelUploadActor = {
  success: true;
  admin: AdminClient;
  organizationId: string;
  actorId: string;
  affectedUserId: string | null;
};

/**
 * Who may upload a personnel document: an Admin for any access class, Büro
 * for standard files, and the employee for their own health evidence.
 */
async function requirePersonnelUploadActor(request: {
  employeeRecordId: string;
  accessClass: PersonnelDocumentAccessClass;
}): Promise<PersonnelUploadActor | ActionFailure> {
  const manager = await requireManagerRecord(request.employeeRecordId);
  if (manager.success) {
    if (request.accessClass !== 'personnel_standard' && manager.role !== 'admin') {
      return { success: false, error: 'not_authorized' };
    }
    const { admin, organizationId, actorId, userId } = manager;
    return { success: true, admin, organizationId, actorId, affectedUserId: userId };
  }
  const self = await getSelfContext();
  if (
    !self.success ||
    self.employeeRecordId !== request.employeeRecordId ||
    request.accessClass !== 'health_evidence'
  ) {
    return { success: false, error: 'not_authorized' };
  }
  const { admin, organizationId, actorId } = self;
  return { success: true, admin, organizationId, actorId, affectedUserId: actorId };
}

export async function createPersonnelDocumentUploadTicket(input: {
  employeeRecordId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType?: string | null;
  accessClass: PersonnelDocumentAccessClass;
  operationId: string;
}): Promise<
  LifecycleResult<{ documentId: string; storagePath: string; uploadUrl: string; cleanupToken: string }>
> {
  const parsed = personnelDocumentUploadTicketInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const request = parsed.data;
  if (request.fileSizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES)
    return { success: false, error: 'file_too_large' };
  const actor = await requirePersonnelUploadActor(request);
  if (!actor.success) return actor;
  const { organizationId, actorId } = actor;
  const documentId = randomUUID();
  const storagePath = buildDocumentStoragePath({ organizationId, documentId, fileName: request.fileName });
  try {
    const cleanupToken = createUploadCleanupToken({
      actorId,
      organizationId,
      employeeRecordId: request.employeeRecordId,
      documentId,
      fileName: request.fileName,
      accessClass: request.accessClass,
      operationId: request.operationId,
    });
    const uploadUrl = await createSignedUploadUrl({
      organizationId,
      path: storagePath,
      contentType: request.mimeType || 'application/octet-stream',
    });
    return { success: true, data: { documentId, storagePath, uploadUrl, cleanupToken } };
  } catch (error) {
    logError('Failed to create personnel document upload ticket', error);
    return { success: false, error: 'ticket_failed' };
  }
}

export async function cleanupPersonnelDocumentUpload(input: unknown): Promise<LifecycleResult> {
  const parsed = personnelDocumentUploadCleanupInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const request = parsed.data;
  const context = await requirePersonnelUploadActor(request);
  if (!context.success) return context;
  const storagePath = buildDocumentStoragePath({
    organizationId: context.organizationId,
    documentId: request.documentId,
    fileName: request.fileName,
  });
  if (
    !isValidUploadCleanupToken(request.cleanupToken, {
      actorId: context.actorId,
      organizationId: context.organizationId,
      employeeRecordId: request.employeeRecordId,
      documentId: request.documentId,
      fileName: request.fileName,
      accessClass: request.accessClass,
      operationId: request.operationId,
    })
  )
    return { success: false, error: 'not_authorized' };
  const upload = { admin: context.admin, organizationId: context.organizationId, storagePath };
  const owner = await readPersonnelUploadOwner(
    upload,
    'cleanupPersonnelDocumentUpload: documents read failed',
  );
  if (owner === undefined) return { success: false, error: 'load_failed' };
  if (owner) return { success: true };
  await discardPersonnelUpload(upload);
  const { error: auditError } = await context.admin.from('document_audit_events').insert({
    organization_id: context.organizationId,
    actor_id: context.actorId,
    event_type: 'storage_cleanup',
    event_payload: {
      documentId: request.documentId,
      reason: 'unfinalized_personnel_upload',
    },
  });
  if (auditError) {
    logError('Failed to record personnel upload cleanup event', auditError);
  }
  return { success: true };
}

export async function finalizePersonnelDocumentUpload(
  input: unknown,
): Promise<LifecycleResult<{ documentId: string }>> {
  const parsed = personnelDocumentUploadInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const request = parsed.data;
  const context = await requirePersonnelUploadActor(request);
  if (!context.success) return context;
  const storagePath = buildDocumentStoragePath({
    organizationId: context.organizationId,
    documentId: request.documentId,
    fileName: request.fileName,
  });
  if (
    !isValidUploadCleanupToken(request.cleanupToken, {
      actorId: context.actorId,
      organizationId: context.organizationId,
      employeeRecordId: request.employeeRecordId,
      documentId: request.documentId,
      fileName: request.fileName,
      accessClass: request.accessClass,
      operationId: request.operationId,
    })
  )
    return { success: false, error: 'not_authorized' };
  const upload = { admin: context.admin, organizationId: context.organizationId, storagePath };
  const head = await acceptPersonnelUpload(upload);
  if (!head.success) return head;
  if (head.sizeBytes > DOCUMENT_MAX_FILE_SIZE_BYTES) {
    await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    return { success: false, error: 'file_too_large' };
  }
  const { data, error } = await context.admin.rpc(
    'finalize_personnel_document_metadata',
    rpcArgs('finalize_personnel_document_metadata', {
      p_actor_id: context.actorId,
      p_organization_id: context.organizationId,
      p_employee_record_id: request.employeeRecordId,
      p_document_id: request.documentId,
      p_storage_bucket: DOCUMENT_STORAGE_BUCKET,
      p_storage_path: storagePath,
      p_original_file_name: request.fileName,
      p_display_name: request.fileName,
      p_category: 'other',
      p_mime_type: head.contentType || 'application/octet-stream',
      p_size_bytes: head.sizeBytes,
      p_document_type: request.documentType,
      p_access_class: request.accessClass,
      p_evidence_state: request.evidenceState,
      p_valid_until: request.validUntil,
      p_operation_id: request.operationId,
      p_request_hash: hashRequest(request),
    }),
  );
  if (error || !data) {
    const normalized = lifecycleFailureCode(error);
    const owner = await readPersonnelUploadOwner(
      upload,
      'finalizePersonnelDocumentUpload: documents read failed',
    );
    // A failed read keeps the object.
    if (owner === null)
      await discardStorageObjects({ organizationId: context.organizationId, paths: [storagePath] });
    return { success: false, error: normalized };
  }
  revalidatePersonnel();
  return { success: true, data: { documentId: data } };
}

export async function getPersonnelDocumentSignedUrl(
  documentIdInput: string,
): Promise<LifecycleResult<{ signedUrl: string }>> {
  const parsedDocumentId = uuidSchema.safeParse(documentIdInput);
  if (!parsedDocumentId.success) return { success: false, error: 'invalid_input' };
  const documentId = parsedDocumentId.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: document, error: documentError } = await loggedRead(
    'getPersonnelDocumentSignedUrl: personnel_documents read failed',
    admin
      // tenant-scope: by-id-then-verified — the document's organization must be one of the caller's memberships, checked below before a URL is signed
      .from('personnel_documents')
      .select(
        'access_class, employee_record_id, documents!inner(id, organization_id, storage_path, display_name, current_version_number, deleted_at), personnel_document_releases(document_version_number, revoked_at)',
      )
      .eq('document_id', documentId)
      .maybeSingle(),
  );
  if (documentError) return { success: false, error: 'load_failed' };
  if (!document) return { success: false, error: 'document_not_found' };
  const parsedFile = signedDocumentFileSchema.safeParse(document.documents);
  if (!parsedFile.success || parsedFile.data.deleted_at)
    return { success: false, error: 'document_not_found' };
  const file = parsedFile.data;
  // A prestart employee may open their own released document; only an
  // operational membership carries the manager role.
  const caller = await resolveSelfServiceContextFor(file.organization_id);
  if (!caller.success) return { success: false, error: 'not_authorized' };
  const { role } = caller.context;
  const { data: employee, error: employeeError } = await loggedRead(
    'getPersonnelDocumentSignedUrl: employee_records read failed',
    admin
      .from('employee_records')
      .select('user_id')
      .eq('organization_id', file.organization_id)
      .eq('id', document.employee_record_id)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  const releases = document.personnel_document_releases;
  const ownReleased =
    employee?.user_id === caller.context.userId &&
    releases.some(
      (release) =>
        release.document_version_number === file.current_version_number && release.revoked_at === null,
    );
  const managerAllowed =
    role === 'admin' || (role === 'buero' && document.access_class === 'personnel_standard');
  if (!ownReleased && !managerAllowed) return { success: false, error: 'not_authorized' };
  try {
    const signedUrl = await createSignedDownloadUrl({
      organizationId: file.organization_id,
      path: file.storage_path,
      disposition: 'attachment',
      downloadFileName: file.display_name,
    });
    return { success: true, data: { signedUrl } };
  } catch (error) {
    logError('Failed to sign personnel document download', error);
    return { success: false, error: 'download_failed' };
  }
}
