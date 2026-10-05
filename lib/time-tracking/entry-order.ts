import type { TimeEntry } from './types';

const boundaryOrder = { break_end: 0, clock_out: 1, clock_in: 2, break_start: 3 };

/** Touching intervals close before the next opens, independent of when a correction was approved. */
export function compareTimeEntries(left: TimeEntry, right: TimeEntry): number {
  return (
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    boundaryOrder[left.entryType] - boundaryOrder[right.entryType] ||
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}
