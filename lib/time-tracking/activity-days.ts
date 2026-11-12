import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import {
  intervalAnchor,
  isMomentaryInterval,
  pairActivityIntervals,
  type ActivityInterval,
} from './activity-intervals';
import type { TimeEntry, TimeEntryStatus } from './types';

// An employee's Verlauf as days of activities. It lives beside the pairing so
// the work pack's first load carries only what „Meine Zeit“ renders.

/** One Berlin day of a person's history: its activities in time order. */
export type ActivityDay = { date: string; intervals: ActivityInterval[] };

/**
 * A person's history as days, newest first, each with its activities in time
 * order, momentary taps left out. A status keeps only the activities of that
 * status, so an approved start with a pending end reads as one pending
 * activity, never as two halves.
 */
export function activityDays(
  entries: readonly TimeEntry[],
  now = new Date(),
  status?: TimeEntryStatus,
): ActivityDay[] {
  const days = new Map<string, ActivityInterval[]>();
  for (const interval of pairActivityIntervals(entries, now)) {
    if (isMomentaryInterval(interval) || (status && interval.status !== status)) continue;
    const date = formatBerlinLocalDate(intervalAnchor(interval).timestamp);
    const day = days.get(date);
    if (day) day.push(interval);
    else days.set(date, [interval]);
  }
  return [...days]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, intervals]) => ({ date, intervals }));
}
