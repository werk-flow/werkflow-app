// Browser-side direct upload helpers for document storage.
//
// Flow per docs/decisions/0001-infrastructure-stack.md: a server action
// authorizes and returns a short-lived signed URL, the browser PUTs the bytes
// straight to object storage (no server in the byte path), and a second server
// action validates the uploaded object and records the metadata.

import {
  createDocumentUploadTicket,
  createDocumentVersionUploadTicket,
  finalizeDocumentUpload,
  finalizeDocumentVersionUpload,
} from './upload-actions';
import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import type {
  DocumentCategory,
  DocumentResult,
  DocumentUploadTarget,
  DocumentVersion,
  OrganizationDocument,
} from './types';
import {
  cleanupPersonnelDocumentUpload,
  createPersonnelDocumentUploadTicket,
  finalizePersonnelDocumentUpload,
} from '@/lib/personnel/lifecycle-actions';
import type { PersonnelDocumentAccessClass, PersonnelDocumentEvidenceState } from '@/lib/personnel/lifecycle';
import { createWorkArtifactSignatureUploadTicket } from '@/lib/work-artifacts/signature-upload-actions';

export type UploadProgressHandler = (fraction: number) => void;

// Shorter than the signed upload URL lifetime (30 min) so a stalled transfer
// fails visibly instead of hanging until the signature expires.
const UPLOAD_TIMEOUT_MS = 25 * 60 * 1000;

function putFileWithProgress(
  url: string,
  file: File,
  onProgress?: UploadProgressHandler,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // XMLHttpRequest instead of fetch because fetch has no upload progress.
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    // Must match the content type the signed URL was created for.
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`storage_put_failed_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('storage_put_network_error'));
    xhr.onabort = () => reject(new Error('storage_put_aborted'));
    xhr.ontimeout = () => reject(new Error('storage_put_timeout'));

    if (signal?.aborted) {
      reject(new Error('storage_put_aborted'));
      return;
    }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

/** Why a file did not arrive. The upload dialog words each reason for the user. */
export type UploadFailureReason =
  | 'interrupted'
  | 'timeout'
  | 'storage_refused'
  | 'too_large'
  | 'empty'
  | 'refused'
  | 'not_saved'
  | 'version_conflict'
  | 'version_unconfirmed';

/**
 * The upload whose bytes reached storage. A retry first registers these
 * bytes instead of sending the file again, so a registration whose answer
 * got lost never registers the file twice.
 */
export type TransferredUpload = { documentId: string; versionNumber: number | null; storagePath: string };

/** A saved upload (`saved` is null when an earlier attempt registered it), or why it failed. */
export type UploadOutcome<Saved> =
  | { status: 'saved'; saved: Saved | null }
  | { status: 'failed'; reason: UploadFailureReason; transferred: TransferredUpload | null };

/** One try of one file: the earlier try's stored bytes, progress and cancellation. */
export type UploadAttempt = {
  transferred: TransferredUpload | null;
  onProgress?: UploadProgressHandler;
  signal?: AbortSignal;
};

function failedUpload<Saved>(
  reason: UploadFailureReason,
  transferred: TransferredUpload | null,
): UploadOutcome<Saved> {
  return { status: 'failed', reason, transferred };
}

/** The reason of a refusal the server answered with. */
function refusalReason(error: string): UploadFailureReason {
  switch (error) {
    case 'file_too_large':
      return 'too_large';
    case 'file_empty':
      return 'empty';
    case 'version_conflict':
      return 'version_conflict';
    case 'ticket_failed':
    case 'load_failed':
    case 'upload_failed':
    case 'file_missing':
    case 'create_failed':
    case 'version_failed':
      return 'not_saved';
    default:
      return 'refused';
  }
}

/** The reason of a transfer or Server Action call that threw. */
function thrownReason(error: unknown): UploadFailureReason {
  if (error instanceof Error && error.message === 'storage_put_timeout') return 'timeout';
  if (error instanceof Error && error.message.startsWith('storage_put_failed_')) return 'storage_refused';
  return 'interrupted';
}

/**
 * Uploads one file into the library or onto a record. After a failed try,
 * pass its `transferred` back: the retry registers the stored bytes, and
 * sends the file again only when storage no longer holds them.
 */
export async function uploadDocumentDirect({
  file,
  target,
  category,
  transferred,
  onProgress,
  signal,
}: UploadAttempt & {
  file: File;
  target: DocumentUploadTarget;
  category?: DocumentCategory;
}): Promise<UploadOutcome<OrganizationDocument>> {
  const registerDocument = (documentId: string) =>
    finalizeDocumentUpload({ documentId, fileName: file.name, category: category ?? null, ...target });
  let stored = transferred;
  try {
    if (stored) {
      const result = await registerDocument(stored.documentId);
      if (result.success) return { status: 'saved', saved: result.document };
      // The lost answer of the earlier try had registered the file.
      if (result.error === 'already_finalized') return { status: 'saved', saved: null };
      if (result.error !== 'file_missing') return failedUpload(refusalReason(result.error), stored);
      stored = null;
    }
    const ticketResult = await createDocumentUploadTicket({
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
      ...target,
    });
    if (!ticketResult.success) return failedUpload(refusalReason(ticketResult.error), null);
    await putFileWithProgress(ticketResult.ticket.uploadUrl, file, onProgress, signal);
    stored = {
      documentId: ticketResult.ticket.documentId,
      versionNumber: null,
      storagePath: ticketResult.ticket.storagePath,
    };
    const result = await registerDocument(stored.documentId);
    if (result.success) return { status: 'saved', saved: result.document };
    return failedUpload(refusalReason(result.error), stored);
  } catch (error) {
    logError('Direct document upload failed', error);
    return failedUpload(thrownReason(error), stored);
  }
}

/** A customer signature of an artifact: the server reserves the upload, so the dialog can discard it unused. */
export async function uploadWorkArtifactSignatureDirect({
  file,
  artifactId,
  target,
}: {
  file: File;
  artifactId: string;
  target: DocumentUploadTarget;
}): Promise<DocumentResult> {
  try {
    const ticketResult = await createWorkArtifactSignatureUploadTicket({
      artifactId,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
    });
    if (!ticketResult.success) return ticketResult;
    await putFileWithProgress(ticketResult.ticket.uploadUrl, file);
    return await finalizeDocumentUpload({
      documentId: ticketResult.ticket.documentId,
      fileName: file.name,
      category: 'photo',
      ...target,
    });
  } catch (error) {
    logError('Direct signature upload failed', error);
    return { success: false, error: 'upload_failed' };
  }
}

/**
 * Uploads a new version of a document. A retry with the earlier try's
 * `transferred` registers the stored bytes first, like `uploadDocumentDirect`.
 * When another person saved a version meanwhile, a first try is a
 * `version_conflict`. A retry that meets a newer version is
 * `version_unconfirmed`: it cannot tell its own lost save from another one.
 */
export async function uploadDocumentVersionDirect({
  documentId,
  file,
  transferred,
  onProgress,
  signal,
}: UploadAttempt & {
  documentId: string;
  file: File;
}): Promise<UploadOutcome<DocumentVersion>> {
  const registerVersion = (versionNumber: number) =>
    finalizeDocumentVersionUpload({ documentId, versionNumber, fileName: file.name });
  let stored = transferred;
  try {
    if (stored && stored.versionNumber !== null) {
      const result = await registerVersion(stored.versionNumber);
      if (result.success) return { status: 'saved', saved: result.version };
      // A lost answer of the earlier try and another person's version look
      // the same here, so the outcome says the save is unconfirmed.
      if (result.error === 'version_conflict') return failedUpload('version_unconfirmed', stored);
      if (result.error !== 'file_missing') return failedUpload(refusalReason(result.error), stored);
      stored = null;
    }
    const ticketResult = await createDocumentVersionUploadTicket({
      documentId,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
    });
    if (!ticketResult.success) return failedUpload(refusalReason(ticketResult.error), null);
    await putFileWithProgress(ticketResult.ticket.uploadUrl, file, onProgress, signal);
    const { versionNumber, storagePath } = ticketResult.ticket;
    stored = { documentId, versionNumber, storagePath };
    const result = await registerVersion(versionNumber);
    if (result.success) return { status: 'saved', saved: result.version };
    return failedUpload(refusalReason(result.error), stored);
  } catch (error) {
    logError('Direct version upload failed', error);
    return failedUpload(thrownReason(error), stored);
  }
}

export async function uploadPersonnelDocumentDirect({
  employeeRecordId,
  file,
  documentType,
  accessClass,
  evidenceState,
  validUntil,
  operationId,
  onProgress,
}: {
  employeeRecordId: string;
  file: File;
  documentType: string;
  accessClass: PersonnelDocumentAccessClass;
  evidenceState: PersonnelDocumentEvidenceState;
  validUntil: string | null;
  operationId: string;
  onProgress?: UploadProgressHandler;
}): Promise<ActionResult<{ data: { documentId: string } }>> {
  let issuedTicket: { documentId: string; cleanupToken: string } | null = null;
  try {
    const ticket = await createPersonnelDocumentUploadTicket({
      employeeRecordId,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
      accessClass,
      operationId,
    });
    if (!ticket.success) return ticket;
    issuedTicket = {
      documentId: ticket.data.documentId,
      cleanupToken: ticket.data.cleanupToken,
    };
    await putFileWithProgress(ticket.data.uploadUrl, file, onProgress);
    const finalized = await finalizePersonnelDocumentUpload({
      employeeRecordId,
      documentId: ticket.data.documentId,
      fileName: file.name,
      documentType,
      accessClass,
      evidenceState,
      validUntil,
      operationId,
      cleanupToken: ticket.data.cleanupToken,
    });
    if (!finalized.success) {
      await cleanupPersonnelDocumentUpload({
        employeeRecordId,
        documentId: ticket.data.documentId,
        fileName: file.name,
        accessClass,
        operationId,
        cleanupToken: ticket.data.cleanupToken,
        // eslint-disable-next-line no-restricted-syntax -- best-effort cleanup of a refused upload; the caller returns the upload failure itself
      }).catch(() => undefined);
    }
    return finalized;
  } catch (error) {
    logError('Direct personnel document upload failed', error);
    if (issuedTicket) {
      await cleanupPersonnelDocumentUpload({
        employeeRecordId,
        documentId: issuedTicket.documentId,
        fileName: file.name,
        accessClass,
        operationId,
        cleanupToken: issuedTicket.cleanupToken,
        // eslint-disable-next-line no-restricted-syntax -- best-effort cleanup of a refused upload; the caller returns the upload failure itself
      }).catch(() => undefined);
    }
    return { success: false, error: 'upload_failed' };
  }
}
