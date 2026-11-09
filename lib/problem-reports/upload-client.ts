import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createProblemReportFileUploadTicket, finalizeProblemReportFileUpload } from './file-actions';
import type { ProblemReportFileKind } from './types';

// The browser half of a report file's upload (docs/technical/document-storage-and-access.md,
// "Report files"): the ticket signs a PUT, the browser sends the bytes straight
// to storage, and the finalize checks and registers the stored copy. No byte
// passes through a Server Action.

export type ProblemReportFile = { kind: ProblemReportFileKind; bytes: Blob; fileName: string };

/**
 * Sends one file of a saved report. A finalize whose earlier answer got lost
 * finds its own registration and counts as sent.
 */
export async function uploadProblemReportFile(
  target: { organizationId: string; reportId: string },
  file: ProblemReportFile,
): Promise<ActionResult> {
  const fields = { ...target, kind: file.kind, fileName: file.fileName };
  try {
    const ticket = await createProblemReportFileUploadTicket({
      ...fields,
      mimeType: file.bytes.type,
      fileSizeBytes: file.bytes.size,
    });
    if (!ticket.success) return ticket;
    const stored = await fetch(ticket.ticket.uploadUrl, {
      method: 'PUT',
      body: file.bytes,
      // The signed URL was created for this content type.
      headers: { 'Content-Type': file.bytes.type },
    });
    if (!stored.ok) return { success: false, error: 'upload_failed' };
    const finalized = await finalizeProblemReportFileUpload({ ...fields, fileId: ticket.ticket.fileId });
    if (!finalized.success && finalized.error === 'already_finalized') return { success: true };
    return finalized;
  } catch (error) {
    logError('uploadProblemReportFile: transfer failed', error);
    return { success: false, error: 'upload_failed' };
  }
}
