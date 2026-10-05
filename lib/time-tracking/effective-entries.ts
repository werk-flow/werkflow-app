import { compareTimeEntries } from '@/lib/time-tracking/entry-order';
import type { TimeEntry } from './types';
import { isSameLocalDay } from './day-utils';

type EffectiveEntryOptions = {
  referenceDate?: Date;
  sameLocalDayOnly?: boolean;
};

function sortTimeEntries(entries: TimeEntry[]): TimeEntry[] {
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
