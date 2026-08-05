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
} from './actions';
import type { DocumentCategory, DocumentResult, VersionResult } from './types';

export type UploadProgressHandler = (fraction: number) => void;

type DocumentUploadTargetInput = {
  folderId?: string | null;
  jobId?: string | null;
  projectId?: string | null;
  clientId?: string | null;
  employeeId?: string | null;
  requestId?: string | null;
};

// Shorter than the signed upload URL lifetime (30 min) so a stalled transfer
// fails visibly instead of hanging until the signature expires.
const UPLOAD_TIMEOUT_MS = 25 * 60 * 1000;

function putFileWithProgress(
  url: string,
  file: File,
  onProgress?: UploadProgressHandler
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

    xhr.send(file);
  });
}

export async function uploadDocumentDirect({
  file,
  target,
  category,
  onProgress,
}: {
  file: File;
  target: DocumentUploadTargetInput;
  category?: DocumentCategory;
  onProgress?: UploadProgressHandler;
}): Promise<DocumentResult> {
  try {
    const ticketResult = await createDocumentUploadTicket({
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
      ...target,
    });

    if (!ticketResult.success) return ticketResult;

    await putFileWithProgress(ticketResult.ticket.uploadUrl, file, onProgress);

    return await finalizeDocumentUpload({
      documentId: ticketResult.ticket.documentId,
      fileName: file.name,
      category: category ?? null,
      ...target,
    });
  } catch (error) {
    console.error('Direct document upload failed:', error);
    return { success: false, error: 'upload_failed' };
  }
}

export async function uploadDocumentVersionDirect({
  documentId,
  file,
  onProgress,
}: {
  documentId: string;
  file: File;
  onProgress?: UploadProgressHandler;
}): Promise<VersionResult> {
  try {
    const ticketResult = await createDocumentVersionUploadTicket({
      documentId,
      fileName: file.name,
      fileSizeBytes: file.size,
      mimeType: file.type || null,
    });

    if (!ticketResult.success) return ticketResult;

    await putFileWithProgress(ticketResult.ticket.uploadUrl, file, onProgress);

    return await finalizeDocumentVersionUpload({
      documentId: ticketResult.ticket.documentId,
      versionNumber: ticketResult.ticket.versionNumber,
      fileName: file.name,
    });
  } catch (error) {
    console.error('Direct version upload failed:', error);
    return { success: false, error: 'upload_failed' };
  }
}
