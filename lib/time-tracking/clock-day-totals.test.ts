import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { liveDayEntriesOf } from '@/lib/testing/live-day-arbitraries';
import { clockDayTotals } from './clock-day-totals';
import { createActivitySelection, type TimeSegmentFact } from './segments';
import type { TimeEntry } from './types';

// Today is Monday, 7 September 2026, in Berlin (CEST), the day the live-day entries project onto.
const NOW = new Date('2026-09-07T10:00:00.000Z');

afterEach(() => setSystemTime());

function segment(
  id: string,
  kind: 'work' | 'travel' | 'break',
  startedAt: string,
  endedAt: string | null,
): TimeSegmentFact {
  return {
    id,
    sessionId: 'session',
    organizationId: 'org',
    employeeRecordId: 'record',
    startedAt,
    endedAt,
    ...createActivitySelection(kind),
  };
}

function manualEntry(id: string, entryType: 'clock_in' | 'clock_out', timestamp: string): TimeEntry {
  return {
    id,
    userId: 'user',
    organizationId: 'org',
    entryType,
    timestamp,
    isManual: true,
    jobId: null,
    status: 'approved',
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

describe('today’s clock totals', () => {
  test('count and draw only the minutes of a segment over midnight that fall on today', () => {
    setSystemTime(NOW);
    const totals = clockDayTotals(
      liveDayEntriesOf([
        segment('overnight', 'work', '2026-09-06T21:30:00.000Z', '2026-09-06T22:30:00.000Z'),
      ]),
      NOW,
    );
    expect(totals.presenceMinutes).toBe(30);
    expect(totals.timelineSegments).toEqual([{ type: 'work', minutes: 30 }]);
  });

  test('leave the running activity out; the client counts it from its start', () => {
    setSystemTime(NOW);
    const totals = clockDayTotals(
      liveDayEntriesOf([
        segment('closed', 'work', '2026-09-07T06:00:00.000Z', '2026-09-07T06:20:00.000Z'),
        segment('running', 'travel', '2026-09-07T06:20:00.000Z', null),
      ]),
      NOW,
    );
    expect(totals.presenceMinutes).toBe(20);
    expect(totals.travelMinutes).toBe(0);
    expect(totals.timelineSegments).toEqual([{ type: 'work', minutes: 20 }]);
  });

  test('draw a manual entry and the segments of the day in time order', () => {
    setSystemTime(NOW);
    const totals = clockDayTotals(
      [
        ...liveDayEntriesOf([
          segment('work', 'work', '2026-09-07T06:00:00.000Z', '2026-09-07T07:00:00.000Z'),
          segment('break', 'break', '2026-09-07T07:00:00.000Z', '2026-09-07T07:15:00.000Z'),
          segment('travel', 'travel', '2026-09-07T07:15:00.000Z', '2026-09-07T07:45:00.000Z'),
        ]),
        manualEntry('manual-in', 'clock_in', '2026-09-07T05:00:00.000Z'),
        manualEntry('manual-out', 'clock_out', '2026-09-07T05:30:00.000Z'),
      ],
      NOW,
    );
    expect(totals).toMatchObject({ presenceMinutes: 135, breakMinutes: 15, travelMinutes: 30 });
    expect(totals.timelineSegments).toEqual([
      { type: 'work', minutes: 30 },
      { type: 'work', minutes: 60 },
      { type: 'break', minutes: 15 },
      { type: 'work', minutes: 30 },
    ]);
  });
});
