// The composer's uploads over held stand-ins (lib/ai/files/upload-client.ts):
// each upload waits until the spec answers it, so the spec sees the first
// frame of a chosen file. The refusal texts and caps stay the real ones
// (lib/ai/files/upload-messages.ts).
import { clearKiDrafts } from '@/lib/ai/chat-draft-clear';
import type { AiUploadedFile } from '@/lib/ai/files/types';

type HeldUpload = {
  name: string;
  answer: (result: { success: true; file: AiUploadedFile } | { success: false; error: string }) => void;
};

declare global {
  interface Window {
    /** Each upload the composer started, in order, until the spec answers it. */
    uiContractKiUploads: HeldUpload[];
    /** The file ids the composer discarded. */
    uiContractKiDiscards: string[];
    /** Set by the spec: the next discard fails, as a lost connection does. */
    uiContractKiDiscardFails: boolean;
    /** Set by the spec to a list: each discard waits there until the spec answers it. */
    uiContractKiHeldDiscards: ((success: boolean) => void)[] | null;
    /** What every sign-out does to the tab's chat drafts. */
    uiContractKiClearDrafts: () => void;
  }
}

window.uiContractKiUploads = [];
window.uiContractKiDiscards = [];
window.uiContractKiDiscardFails = false;
window.uiContractKiHeldDiscards = null;
window.uiContractKiClearDrafts = clearKiDrafts;

export function uploadAiFile(
  _organizationId: string,
  file: File,
): Promise<{ success: true; file: AiUploadedFile } | { success: false; error: string }> {
  return new Promise((answer) => window.uiContractKiUploads.push({ name: file.name, answer }));
}

type DiscardResult = { success: true } | { success: false; error: string };

export async function discardAiFile(input: {
  organizationId: string;
  fileId: string;
}): Promise<DiscardResult> {
  window.uiContractKiDiscards.push(input.fileId);
  const held = window.uiContractKiHeldDiscards;
  if (held)
    return new Promise((answer) =>
      held.push((success) =>
        answer(success ? { success: true } : { success: false, error: 'discard_failed' }),
      ),
    );
  if (!window.uiContractKiDiscardFails) return { success: true };
  window.uiContractKiDiscardFails = false;
  return { success: false, error: 'discard_failed' };
}

/** The ten-minute address the server would sign for a file of the person's thread. */
export function readKiFileUrlContract(input: unknown) {
  const fileId = input && typeof input === 'object' && 'fileId' in input ? String(input.fileId) : '';
  return { success: true, url: `/ki-datei/${fileId}?X-Amz-Expires=600` };
}
