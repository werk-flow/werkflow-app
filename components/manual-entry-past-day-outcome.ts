// How the form reads the answer to an earlier-day send (manual-entry-past-day.ts).

/** The answer of one send: saved, a replay of the operation's first send, or a refusal. */
export type PastDaySendResult = { saved: true; replayed: boolean } | { saved: false; message: string };

/**
 * What a send means for the form. The server answers a repeated operation id
 * with the correction it first saved („replayed“). When the form changed
 * since that first send, the earlier version stands and the edits did not
 * reach the server; the form must say so instead of reporting a save.
 */
export function pastDayOutcome(
  result: PastDaySendResult,
  editedSinceFirstSend: boolean,
): { kind: 'saved' } | { kind: 'earlier-version-saved' } | { kind: 'failed'; message: string } {
  if (!result.saved) return { kind: 'failed', message: result.message };
  return result.replayed && editedSinceFirstSend ? { kind: 'earlier-version-saved' } : { kind: 'saved' };
}

/**
 * The operation id a form's earlier-day sends share, with the content of the
 * first send that may have been saved under it; null until such a send.
 */
export type PastDayOperation = { id: string; savedContent: string | null };

/**
 * The operation the next send runs under, and whether the form changed since
 * a send that may have been saved: a lost response leaves that content, a
 * refusal leaves none.
 */
export function startPastDaySend(
  operation: PastDayOperation | null,
  content: string,
  newId: () => string,
): { operation: PastDayOperation; editedSinceFirstSend: boolean } {
  const current = operation ?? { id: newId(), savedContent: null };
  return {
    operation: { id: current.id, savedContent: current.savedContent ?? content },
    editedSinceFirstSend: current.savedContent !== null && current.savedContent !== content,
  };
}

/**
 * The operation after a send's answer. Saved, or an earlier version stands:
 * the next send is a new correction. A refusal saved nothing under the id, so
 * the next send's content becomes the one to compare with.
 */
export function finishPastDaySend(
  operation: PastDayOperation,
  outcome: 'saved' | 'earlier-version-saved' | 'failed',
): PastDayOperation | null {
  return outcome === 'failed' ? { id: operation.id, savedContent: null } : null;
}

export const EARLIER_VERSION_SAVED =
  'Dein Nachtrag war schon mit den vorherigen Angaben eingereicht. Deine Änderungen sind nicht gespeichert. Prüfe ihn im Verlauf und zieh ihn bei Bedarf zurück.';
