import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createProblemReportFileUploadTicket, finalizeProblemReportFileUpload } from './file-actions';
import type { ProblemReportFileKind } from './types';

// The browser half of a report file's upload (docs/technical/document-storage-and-access.md,
// "Report files"): the ticket signs a PUT, the browser sends the bytes straight
// to storage, and the finalize checks and registers the stored copy. No byte
// passes through a Server Action.

export type ProblemReportFile = { kind: ProblemReportFileKind; bytes: Blob; fileName: string };

/** Finalize refusals after which the server discarded the stored copy. */
const DISCARDED_ON_REFUSAL: ReadonlySet<string> = new Set([
  'file_type_not_allowed',
  'file_empty',
  'file_too_large',
]);

/** The stored file id a retry may register: none once a refusal discarded the copy. */
function kept(result: ActionResult, fileId: string): string | null {
  return !result.success && DISCARDED_ON_REFUSAL.has(result.error) ? null : fileId;
}

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
    if (finalized.success) return finalized;
    // A screenshot whose first finalize committed after this retry found its
    // staging key gone is the report's screenshot: there is only one.
    const registered =
      finalized.error === 'already_finalized' ||
      (file.kind === 'screenshot' && finalized.error === 'screenshot_exists');
    return registered ? { success: true } : finalized;
  };
  let stored = storedFileId;
  try {
    if (stored) {
      const result = await register(stored);
      if (result.success || result.error !== 'file_missing')
        return { result, storedFileId: kept(result, stored) };
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
    const result = await register(stored);
    return { result, storedFileId: kept(result, stored) };
  } catch (error) {
    logError('uploadProblemReportFile: transfer failed', error);
    return { result: { success: false, error: 'upload_failed' }, storedFileId: stored };
  }
}
