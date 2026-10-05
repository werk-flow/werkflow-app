import { describe, expect, test } from 'bun:test';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { entriesWithinWindow, mergeEntriesById } from './manual-entry-merge';

function entry(id: string, timestamp: string, createdAt = timestamp): TimeEntry {
  return {
    id,
    userId: 'user-a',
    organizationId: 'org-1',
    entryType: 'clock_in',
    timestamp,
    isManual: true,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('entriesWithinWindow', () => {
  test('keeps entries on both bounds and drops the ones outside', () => {
    const window = { start: new Date('2026-10-05T00:00:00Z'), end: new Date('2026-10-11T23:59:59Z') };
    const inside = [entry('a', '2026-10-05T00:00:00Z'), entry('b', '2026-10-11T23:59:59Z')];
    expect(entriesWithinWindow([...inside, entry('c', '2026-10-12T00:00:00Z')], window)).toEqual(inside);
  });
});

describe('mergeEntriesById', () => {
  test('replaces by id and orders by timestamp, then by creation time', () => {
    const previous = [entry('a', '2026-10-05T09:00:00Z'), entry('b', '2026-10-05T07:00:00Z')];
    const merged = mergeEntriesById(previous, [
      entry('a', '2026-10-05T06:00:00Z'),
      entry('c', '2026-10-05T07:00:00Z', '2026-10-01T00:00:00Z'),
    ]);
    expect(merged.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(previous.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
