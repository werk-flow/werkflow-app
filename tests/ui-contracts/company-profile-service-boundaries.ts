// Isolated stand-in for `@/lib/company-profile/actions`: the save waits in
// the write gate until the spec answers it, so the spec reads what the form
// sent. The file actions are not part of the contract.
import type { SaveCompanyProfileResult } from '@/lib/company-profile/profile';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

export async function saveCompanyDocumentProfile(input: unknown): Promise<SaveCompanyProfileResult> {
  const refusal = await holdWrite('save-company-profile', input);
  return refusal ? { success: false, error: refusal } : { success: true, version: 4 };
}

export const createCompanyDocumentFileUploadTicket = unexpectedWrite;
export const finalizeCompanyDocumentFileUpload = unexpectedWrite;
export const removeCompanyDocumentFile = unexpectedWrite;
