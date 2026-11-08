import { isSameLocalDay } from '@/lib/date-time/berlin';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { getEffectiveTimeEntries } from '@/lib/time-tracking/effective-entries';
import { calculateWorkSessions } from '@/lib/time-tracking/work-sessions';
import { NO_RECORDED_VISIT, type RecordedVisitWindow } from './types';

/**
 * Today's recorded work of one person on one job, as a work report's visit
 * window: the first start and, once every session of today closed, the last
 * end. It only reads the time records; the report never writes time.
 */
export function recordedVisitWindow(
  entries: readonly TimeEntry[],
  scope: { jobId: string; userId: string; now: Date },
): RecordedVisitWindow {
  // The pairing reads the entries in their canonical order and drops rejected or future ones.
  const own = entries.filter((entry) => entry.userId === scope.userId);
  const today = calculateWorkSessions(own).filter(
    (session) =>
      session.clockIn !== null &&
      !session.isOrphan &&
      session.jobId === scope.jobId &&
      isSameLocalDay(new Date(session.clockIn.timestamp), scope.now),
  );
  const first = today[0]?.clockIn;
  if (!first) return NO_RECORDED_VISIT;
  const ends = today.map((session) => session.clockOut?.timestamp ?? null);
  const open = ends.some((end) => end === null);
  if (open) return { startedAt: first.timestamp, endedAt: null };
  return { startedAt: first.timestamp, endedAt: endAfterBreak(own, today.at(-1)) };
}

/**
 * The end of the last session. A session that ended with „Pause“ is not the
 * end of the day: while the break is open the time is still running, so
 * Ende stays empty; a clock-out during the break is the end.
 */
function endAfterBreak(
  own: readonly TimeEntry[],
  last: { clockOut: TimeEntry | null; endEntryType?: 'break_start' | 'clock_out' | null } | undefined,
): string | null {
  const end = last?.clockOut;
  if (!end) return null;
  if (last.endEntryType !== 'break_start') return end.timestamp;
  const breakStart = Date.parse(end.timestamp);
  const next = getEffectiveTimeEntries([...own])
    .filter(
      (entry) =>
        Date.parse(entry.timestamp) > breakStart &&
        (entry.entryType === 'break_end' || entry.entryType === 'clock_out'),
    )
    .toSorted((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))[0];
  return next?.entryType === 'clock_out' ? next.timestamp : null;
}
