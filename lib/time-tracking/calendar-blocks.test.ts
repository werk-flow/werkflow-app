// The calendar's day never shows a block or a segment shorter than a minute,
// which it would read as „Arbeit 08:16–08:16“.
import { expect, test } from 'bun:test';
import { actualMinutesByUserDate } from '@/lib/calendar/board-model';
import { calculateCalendarWorkBlocks, getCalendarBlockDisplaySegments } from './calendar-blocks';
import type { TimeEntry, TimeEntryType } from './types';

const NOW = new Date('2026-09-18T10:00:00.000Z');

function entry(id: string, entryType: TimeEntryType, timestamp: string): TimeEntry {
  return {
    id,
    userId: '20000000-0000-4000-8000-000000000001',
    organizationId: '10000000-0000-4000-8000-000000000001',
    entryType,
    timestamp,
    isManual: false,
    jobId: '40000000-0000-4000-8000-000000000001',
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test('a block shorter than a minute is left out; a block of a minute stays', () => {
  const blocks = calculateCalendarWorkBlocks([
    entry('tap-in', 'clock_in', '2026-09-17T06:15:10.000Z'),
    entry('tap-out', 'clock_out', '2026-09-17T06:15:40.000Z'),
    entry('in', 'clock_in', '2026-09-17T06:16:00.000Z'),
    entry('out', 'clock_out', '2026-09-17T06:17:00.000Z'),
  ]);
  expect(blocks.map((block) => block.startEntry.id)).toEqual(['in']);
});

test("a block's segment shorter than a minute is left out of the day", () => {
  const [block] = calculateCalendarWorkBlocks([
    entry('in', 'clock_in', '2026-09-17T06:16:00.000Z'),
    entry('pause', 'break_start', '2026-09-17T06:16:20.000Z'),
    entry('resume', 'break_end', '2026-09-17T06:30:00.000Z'),
    entry('out', 'clock_out', '2026-09-17T08:00:00.000Z'),
  ]);
  if (!block) throw new Error('The day keeps its block.');
  expect(
    getCalendarBlockDisplaySegments(block, NOW).map((segment) => [segment.type, segment.start, segment.end]),
  ).toEqual([
    ['break', '2026-09-17T06:16:20.000Z', '2026-09-17T06:30:00.000Z'],
    ['work', '2026-09-17T06:30:00.000Z', '2026-09-17T08:00:00.000Z'],
  ]);
});

test("the board's actual-time strip leaves out a block shorter than a minute, so it moves by seconds only", () => {
  const totals = actualMinutesByUserDate(
    [
      entry('tap-in', 'clock_in', '2026-09-17T06:15:00.000Z'),
      entry('tap-out', 'clock_out', '2026-09-17T06:15:30.000Z'),
      entry('in', 'clock_in', '2026-09-17T06:16:00.000Z'),
      entry('out', 'clock_out', '2026-09-17T08:16:00.000Z'),
    ],
    NOW,
  );
  expect([...totals.values()]).toEqual([{ minutes: 120, pending: false }]);
});
