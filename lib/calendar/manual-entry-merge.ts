import type { TimeEntry } from '@/lib/time-tracking/types';

/** The entries whose timestamp falls inside the calendar's read window, bounds included. */
export function entriesWithinWindow(entries: TimeEntry[], window: { start: Date; end: Date }): TimeEntry[] {
  return entries.filter((entry) => {
    const timestamp = new Date(entry.timestamp).getTime();
    return timestamp >= window.start.getTime() && timestamp <= window.end.getTime();
  });
}

/** Adds or replaces entries by id and keeps the list in timestamp order, creation time breaking ties. */
export function mergeEntriesById(previous: TimeEntry[], additions: TimeEntry[]): TimeEntry[] {
  const merged = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of additions) merged.set(entry.id, entry);
  return sortEntriesByTimestamp([...merged.values()]);
}

function sortEntriesByTimestamp(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}
