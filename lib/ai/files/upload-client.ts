import { logError } from '@/lib/logging';
import { createAiFileUploadTicket, finalizeAiFileUpload } from './actions';
import type { AiFileFinalizeResult } from './types';

// The browser half of a WerkFlow KI upload (lib/ai/files/upload.ts): the ticket
// signs a PUT, the browser sends the bytes straight to storage, and the
// finalize checks and registers the stored copy. No byte passes through a
// Server Action.

/** Sends one file to storage and registers it: the file, or a refusal code. */
export async function uploadAiFile(organizationId: string, file: File): Promise<AiFileFinalizeResult> {
  try {
    const ticket = await createAiFileUploadTicket({
      organizationId,
      mimeType: file.type,
      fileSizeBytes: file.size,
    });
    if (!ticket.success) return ticket;
    // The signed URL was created for this content type.
    const put = await fetch(ticket.uploadUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!put.ok) return { success: false, error: 'upload_failed' };
    // A name over the stored cap keeps its first 200 characters, counted by code point.
    const fileName = Array.from(file.name.trim()).slice(0, 200).join('') || 'Datei';
    return await finalizeAiFileUpload({ organizationId, fileId: ticket.fileId, fileName });
  } catch (error) {
    logError('uploadAiFile: transfer failed', error);
    return { success: false, error: 'upload_failed' };
  }
}
