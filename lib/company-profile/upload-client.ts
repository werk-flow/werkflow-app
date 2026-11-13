import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';

import { createCompanyDocumentFileUploadTicket, finalizeCompanyDocumentFileUpload } from './actions';
import type { CompanyFileKind } from './profile';

// The browser half of a logo or stationery upload: the ticket signs a PUT,
// the browser sends the bytes straight to storage, and the finalize checks
// and registers the stored copy. No byte passes through a Server Action.

/** Uploads `file` in place of the stored file the caller saw (`expectedStoragePath`, null for none). */
export async function uploadCompanyFile(
  organizationId: string,
  kind: CompanyFileKind,
  file: File,
  expectedStoragePath: string | null,
): Promise<ActionResult> {
  try {
    const ticket = await createCompanyDocumentFileUploadTicket({
      organizationId,
      kind,
      mimeType: file.type,
      fileSizeBytes: file.size,
    });
    if (!ticket.success) return ticket;
    const put = await fetch(ticket.ticket.uploadUrl, {
      method: 'PUT',
      body: file,
      // The signed URL was created for this content type.
      headers: { 'Content-Type': file.type },
    });
    if (!put.ok) return { success: false, error: 'upload_failed' };
    return await finalizeCompanyDocumentFileUpload({
      organizationId,
      kind,
      fileId: ticket.ticket.fileId,
      expectedStoragePath,
    });
  } catch (error) {
    logError('uploadCompanyFile: transfer failed', error);
    return { success: false, error: 'upload_failed' };
  }
}
