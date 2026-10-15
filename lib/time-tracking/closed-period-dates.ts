import { getLocalDayKey, getLocalDayStart } from './day-utils';
import type { TimeEntry } from './types';

/** A closed period of an organization: its first and last Europe/Berlin date, both inclusive. */
export type ClosedTimePeriod = { readonly startDate: string; readonly endDate: string };

const NO_CLOSED_PERIODS: readonly ClosedTimePeriod[] = [];

/**
 * The closed periods a surface may hide edits for: only a current read
 * counts. Without a read, or after a failed refresh (the live view keeps the
 * last-known list), the list is empty, so an edit of a period reopened since
 * stays offered and the server's `period_closed` refusal remains the backstop.
 */
export function closedPeriodsToHide(
  data: readonly ClosedTimePeriod[] | undefined,
  stale: boolean,
): readonly ClosedTimePeriod[] {
  return stale || !data ? NO_CLOSED_PERIODS : data;
}

/**
 * True when a Europe/Berlin date (`YYYY-MM-DD`) lies inside a closed period.
 * The database refuses every write to a recorded time fact on such a date
 * with `period_closed`; a surface asks this first and offers no such edit,
 * and the server keeps its refusal as the backstop.
 */
export function isDateInClosedPeriod(date: string, closedPeriods: readonly ClosedTimePeriod[]): boolean {
  return closedPeriods.some((period) => period.startDate <= date && date <= period.endDate);
}

/**
 * The Europe/Berlin date a recorded entry belongs to. A closing entry at
 * exactly midnight still closes the day before, as the database's
 * closed-period guard counts it.
 */
export function entryBusinessDate(entry: Pick<TimeEntry, 'timestamp' | 'entryType'>): string {
  const instant = new Date(entry.timestamp);
  const closesAtMidnight =
    (entry.entryType === 'clock_out' || entry.entryType === 'break_end') &&
    getLocalDayStart(instant).getTime() === instant.getTime();
  return getLocalDayKey(closesAtMidnight ? new Date(instant.getTime() - 1) : instant);
}

/** True when the recorded entry belongs to a day of a closed period. */
export function isEntryInClosedPeriod(
  entry: Pick<TimeEntry, 'timestamp' | 'entryType'>,
  closedPeriods: readonly ClosedTimePeriod[],
): boolean {
  return isDateInClosedPeriod(entryBusinessDate(entry), closedPeriods);
}
