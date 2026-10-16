import { compareTimeEntries } from '@/lib/time-tracking/entry-order';
import type { TimeEntry } from './types';
import { isSameLocalDay } from '@/lib/date-time/berlin';

type EffectiveEntryOptions = {
  referenceDate?: Date;
  sameLocalDayOnly?: boolean;
};

/** Time entries in their canonical order (compareTimeEntries), as a new array. */
export function sortTimeEntries(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort(compareTimeEntries);
}

export function getEffectiveTimeEntries(entries: TimeEntry[], options?: EffectiveEntryOptions): TimeEntry[] {
  const referenceDate = options?.referenceDate ?? new Date();

  return sortTimeEntries(
    entries.filter((entry) => {
      if (entry.status === 'rejected' || entry.status === 'pending_delete') {
        return false;
      }

      const entryDate = new Date(entry.timestamp);
      if (entryDate.getTime() > referenceDate.getTime()) {
        return false;
      }

      if (options?.sameLocalDayOnly && !isSameLocalDay(entryDate, referenceDate)) {
        return false;
      }

      return true;
    }),
  );
}
