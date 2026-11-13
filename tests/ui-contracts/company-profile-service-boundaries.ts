// Isolated stand-in for `@/lib/company-profile/actions`, and for the router
// of the Einstellungen skeletons: the save and the removal wait in the write
// gate until the spec answers them, so the spec reads what the surface sent
// and answers after a switch. Uploads are not part of the contracts.
import type { ActionResult } from '@/lib/action-result';
import type { SaveCompanyProfileResult } from '@/lib/company-profile/profile';
import { holdWrite, unexpectedWrite } from './held-write-boundary';

export async function saveCompanyDocumentProfile(input: unknown): Promise<SaveCompanyProfileResult> {
  const refusal = await holdWrite('save-company-profile', input);
  return refusal ? { success: false, error: refusal } : { success: true, version: 4 };
}

export async function removeCompanyDocumentFile(input: unknown): Promise<ActionResult> {
  const refusal = await holdWrite('remove-company-file', input);
  return refusal ? { success: false, error: refusal } : { success: true };
}

export const createCompanyDocumentFileUploadTicket = unexpectedWrite;
export const finalizeCompanyDocumentFileUpload = unexpectedWrite;

export function usePathname(): string {
  return '/einstellungen/dokumente';
}
