// One operation id across a form's sends of a Zeitkorrektur, and what each
// answer means. The employee's earlier-day „Zeit nachtragen“
// (use-manual-entry-form-submit.ts) and the Zeitkorrektur dialog
// (zeiterfassung/time-correction-dialog-send.ts) both send through here.

import type { TimeCorrectionStatus } from '@/lib/time-corrections/types';

/** The answer of one send: saved, a replay of the operation's first save, or a refusal. */
export type CorrectionSendResult =
  | { saved: true; replayed: boolean; status: TimeCorrectionStatus }
  | { saved: false; message: string };

/** What a send means for the form. */
export type CorrectionSendOutcome =
  | { kind: 'saved'; status: TimeCorrectionStatus }
  | { kind: 'earlier-version-saved' }
  | { kind: 'failed'; message: string };

/**
 * The operation id a form's sends share, with the content of the first send
 * that may have been saved under it; null until such a send.
 */
export type CorrectionOperation = { id: string; savedContent: string | null };

/**
 * Sends `content` under the form's operation and returns what the answer
 * means. The server answers a repeated operation id with the correction it
 * first saved („replayed“) and never compares the content. When the content
 * changed since a send that may have been saved, a replay means the earlier
 * version stands and the edits did not reach the server.
 *
 * The operation after the send:
 * - saved, or an earlier version stands: none, so the next send is a new correction;
 * - refused: as before this send, which saved nothing; an earlier send whose
 *   answer was lost may still have saved its content;
 * - thrown: kept with this content, because the outcome is unknown.
 *
 * `operationRef` is the form's own; a form that starts a new operation while a
 * send runs (a new opening of a dialog) keeps the new one.
 */
export async function sendUnderOperation(
  operationRef: { current: CorrectionOperation | null },
  content: string,
  send: (operationId: string) => Promise<CorrectionSendResult>,
  newId: () => string = () => crypto.randomUUID(),
): Promise<CorrectionSendOutcome> {
  const before = operationRef.current ?? { id: newId(), savedContent: null };
  const editedSinceFirstSend = before.savedContent !== null && before.savedContent !== content;
  const sending = { id: before.id, savedContent: before.savedContent ?? content };
  operationRef.current = sending;
  const result = await send(sending.id);
  const settle = (next: CorrectionOperation | null): void => {
    if (operationRef.current === sending) operationRef.current = next;
  };
  if (!result.saved) {
    settle(before);
    return { kind: 'failed', message: result.message };
  }
  settle(null);
  return result.replayed && editedSinceFirstSend
    ? { kind: 'earlier-version-saved' }
    : { kind: 'saved', status: result.status };
}
