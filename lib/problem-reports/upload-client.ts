import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createProblemReportFileUploadTicket, finalizeProblemReportFileUpload } from './file-actions';
import type { ProblemReportFileKind } from './types';

// The browser half of a report file's upload (docs/technical/document-storage-and-access.md,
// "Report files"): the ticket signs a PUT, the browser sends the bytes straight
// to storage, and the finalize checks and registers the stored copy. No byte
// passes through a Server Action.

export type ProblemReportFile = { kind: ProblemReportFileKind; bytes: Blob; fileName: string };

/** One try: its result, and the file id whose bytes reached storage, for the next try. */
export type ProblemReportUploadOutcome = { result: ActionResult; storedFileId: string | null };

/**
 * Sends one file of a saved report. After a failed try, pass its
 * `storedFileId` back: the retry registers those bytes first, so a finalize
 * whose answer got lost is found, not repeated under a new id. It sends the
 * bytes again only when storage no longer holds them.
 */
export async function uploadProblemReportFile(
  target: { organizationId: string; reportId: string },
  file: ProblemReportFile,
  storedFileId: string | null,
): Promise<ProblemReportUploadOutcome> {
  const fields = { ...target, kind: file.kind, fileName: file.fileName };
  const register = async (fileId: string): Promise<ActionResult> => {
    const finalized = await finalizeProblemReportFileUpload({ ...fields, fileId });
    return !finalized.success && finalized.error === 'already_finalized' ? { success: true } : finalized;
  };
  let stored = storedFileId;
  try {
    if (stored) {
      const result = await register(stored);
      if (result.success || result.error !== 'file_missing') return { result, storedFileId: stored };
      stored = null;
    }
    const ticket = await createProblemReportFileUploadTicket({
      ...fields,
      mimeType: file.bytes.type,
      fileSizeBytes: file.bytes.size,
    });
    if (!ticket.success) return { result: ticket, storedFileId: null };
    const put = await fetch(ticket.ticket.uploadUrl, {
      method: 'PUT',
      body: file.bytes,
      // The signed URL was created for this content type.
      headers: { 'Content-Type': file.bytes.type },
    });
    if (!put.ok) return { result: { success: false, error: 'upload_failed' }, storedFileId: null };
    stored = ticket.ticket.fileId;
    return { result: await register(stored), storedFileId: stored };
  } catch (error) {
    logError('uploadProblemReportFile: transfer failed', error);
    return { result: { success: false, error: 'upload_failed' }, storedFileId: stored };
  }
}
