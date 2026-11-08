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

export const EARLIER_VERSION_SAVED =
  'Dein Nachtrag war schon mit den vorherigen Angaben eingereicht. Deine Änderungen sind nicht gespeichert. Prüfe ihn im Verlauf und zieh ihn bei Bedarf zurück.';
