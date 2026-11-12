// Stand-in for `@/lib/work-handover/actions` and `@/lib/documents/actions` as
// the handover review writes through them: a draft save and a preview wait in the held-write gate until the
// spec answers, and every other handover write is a contract violation.
import { holdWrite, unexpectedWrite } from './held-write-boundary';

type HandoverActions = typeof import('@/lib/work-handover/actions');
type SaveInput = Parameters<HandoverActions['saveWorkHandoverDraft']>[0];
type PreviewInput = Parameters<HandoverActions['previewWorkHandover']>[0];

export async function saveWorkHandoverDraft(
  input: SaveInput,
): ReturnType<HandoverActions['saveWorkHandoverDraft']> {
  const refusal = await holdWrite('save-draft', input);
  return refusal === null
    ? { success: true, packageId: input.packageId, packageVersion: input.expectedPackageVersion + 1 }
    : { success: false, error: refusal };
}

export async function previewWorkHandover(
  input: PreviewInput,
): ReturnType<HandoverActions['previewWorkHandover']> {
  const refusal = await holdWrite('preview', input);
  return refusal === null
    ? { success: true, html: '<p>Übergabepaket</p>', contentHash: 'a'.repeat(64), fileName: 'uebergabe.html' }
    : { success: false, error: refusal };
}

export const releaseWorkHandover = unexpectedWrite;
export const withdrawWorkHandover = unexpectedWrite;
export const returnWorkHandoverForCorrection = unexpectedWrite;
// The review opens no release document in these contracts.
export const getDocumentSignedUrl = unexpectedWrite;
