import { getLocalDayStart } from '@/lib/date-time/berlin';
import type { LiveClockState, TimeEntry } from '@/lib/time-tracking/types';
import { correctionScope, type ClockDeviceView, type UnsentTimeEvent } from './time-outbox';

// A late chain of a session the server holds or held (decision record 0010, "a late chain of a
// session that still runs"). The person settles it with one correction that replaces the end the
// server recorded for that session, through the clock or a recovery, with the end the phone captured.
// The session ends first, so the span counts once: as the approved replacement.

export type SessionReplacement = {
  /** The events the correction covers: they leave the phone only once it is filed. */
  events: UnsentTimeEvent[];
  /** The server's session the chain's first event expects. */
  sessionId: string;
  /** The session's segment that ran when the chain began: the one whose end the correction replaces. */
  segmentId: string;
  /** When the person ended work, as the phone captured it. */
  capturedEnd: string;
};

/**
 * The replacement a late chain offers: its first event came too late to be recorded by itself
 * (`correction_required`), expects a session on the server, and the events one correction covers
 * (correctionScope) are that session's end alone. Null for any other stop, a chain that starts its own
 * session or holds no end, while the server's clock is unknown, and when the phone does not know which
 * segment ran when the chain began: without it, another session's time could be corrected.
 *
 * Null as well when a switch comes before the end: the one edit replaces only the recorded end, so a
 * break or another activity the switch records would be lost once the events leave the phone. Such a
 * chain keeps the order that shows the person every captured time.
 */
export function sessionReplacement(
  view: ClockDeviceView,
  confirmed: LiveClockState | null,
): SessionReplacement | null {
  const [first] = view.events;
  const sessionId = first?.expected?.sessionId;
  const segmentId = view.chainSegmentId;
  // Only a late chain: a conflict or a refusal is no captured truth the server lacks, and stays as it is.
  if (view.status !== 'stopped' || first?.status !== 'correction' || !confirmed || !sessionId || !segmentId)
    return null;
  const events = correctionScope(view);
  const [end, ...more] = events;
  return end?.action === 'end' && more.length === 0
    ? { events, sessionId, segmentId, capturedEnd: end.capturedAt }
    : null;
}

/** The window the session's recorded entries are read in: from the Berlin day the chain began until now. */
export function replacementWindow(replacement: SessionReplacement, now: Date): { from: string; to: string } {
  const begin = replacement.events[0]?.capturedAt ?? replacement.capturedEnd;
  return { from: getLocalDayStart(new Date(begin)).toISOString(), to: now.toISOString() };
}

/**
 * The entry the correction edits: the last end the server recorded for the segment that ran when the
 * chain began, when it still ran at the chain's captured end. Its time is the captured end, which the
 * correction form shows as the new time. Null otherwise: the session ended before the captured end,
 * a correction already replaced it, or another device changed the session meanwhile.
 */
export function replacedSegmentEnd(
  entries: readonly TimeEntry[],
  replacement: SessionReplacement,
): TimeEntry | null {
  const begin = Date.parse(replacement.events[0]?.capturedAt ?? replacement.capturedEnd);
  const end = Date.parse(replacement.capturedEnd);
  const ordered = entries
    .filter(
      (entry) =>
        entry.sourceKind === 'canonical_segment' && entry.canonicalSegmentId === replacement.segmentId,
    )
    .toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const last = ordered.findLast((piece) => piece.entryType === 'clock_out');
  const ranAtBegin = ordered.some((piece) => Date.parse(piece.timestamp) <= begin);
  return last && ranAtBegin && Date.parse(last.timestamp) >= end
    ? { ...last, timestamp: replacement.capturedEnd }
    : null;
}
