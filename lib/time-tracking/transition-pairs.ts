import type { TimeEntry } from './types';
import { isSameLocalDay } from './day-utils';

export function isBreakEndFollowedByClockIn(
  entries: TimeEntry[],
  index: number
): boolean {
  const entry = entries[index];
  const nextEntry = entries[index + 1];

  if (!entry || entry.entryType !== 'break_end' || !nextEntry) {
    return false;
  }

  return (
    nextEntry.entryType === 'clock_in' &&
    isSameLocalDay(new Date(entry.timestamp), new Date(nextEntry.timestamp))
  );
}
