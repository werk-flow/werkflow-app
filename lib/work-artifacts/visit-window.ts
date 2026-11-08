import { isSameLocalDay } from '@/lib/date-time/berlin';
import type { TimeEntry } from '@/lib/time-tracking/types';
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
  return { startedAt: first.timestamp, endedAt: open ? null : (ends.at(-1) ?? null) };
}
