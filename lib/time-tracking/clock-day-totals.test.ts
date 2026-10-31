import { describe, expect, test } from 'bun:test';
import { canonicalDayTotals, combineClockDayTotals, type ClockDayTotals } from './clock-day-totals';
import type { TimeSegmentFact } from './segments';

const dayStart = new Date('2026-10-26T23:00:00.000Z');
const dayEnd = new Date('2026-10-27T22:59:59.999Z');

function segment(id: string, startedAt: string, endedAt: string | null): TimeSegmentFact {
  return {
    id,
    sessionId: 'session',
    organizationId: 'organization',
    employeeRecordId: 'employee',
    kind: 'work',
    allocationKind: 'unallocated',
    jobId: null,
    startedAt,
    endedAt,
  };
}

describe('canonical day totals', () => {
  test('a segment over midnight counts and draws only its minutes of the day', () => {
    const totals = canonicalDayTotals(
      [segment('overnight', '2026-10-26T22:30:00.000Z', '2026-10-26T23:30:00.000Z')],
      dayStart,
      dayEnd,
    );
    expect(totals.presenceMinutes).toBe(30);
    expect(totals.timelineSegments).toEqual([{ type: 'work', minutes: 30 }]);
  });

  test('the running segment adds nothing; the client counts it from its start', () => {
    const totals = canonicalDayTotals(
      [
        segment('closed', '2026-10-27T06:00:00.000Z', '2026-10-27T06:20:00.000Z'),
        segment('running', '2026-10-27T06:20:00.000Z', null),
      ],
      dayStart,
      dayEnd,
    );
    expect(totals.presenceMinutes).toBe(20);
    expect(totals.timelineSegments).toEqual([{ type: 'work', minutes: 20 }]);
  });
});

describe('both capture models in one day', () => {
  const totals = (segments: ClockDayTotals['timelineSegments']): ClockDayTotals => ({
    presenceMinutes: 60,
    breakMinutes: 0,
    travelMinutes: 0,
    standbyMinutes: 0,
    calloutMinutes: 0,
    internalMinutes: 0,
    timelineSegments: segments,
  });

  test('draw no block order when both carry blocks, so the ring shows its aggregate view', () => {
    const combined = combineClockDayTotals(
      totals([{ type: 'work', minutes: 60 }]),
      totals([{ type: 'break', minutes: 15 }]),
    );
    expect(combined.timelineSegments).toEqual([]);
    expect(combined.presenceMinutes).toBe(120);
  });

  test('keep the blocks of the one model that has any', () => {
    const blocks = [{ type: 'work' as const, minutes: 60 }];
    expect(combineClockDayTotals(totals([]), totals(blocks)).timelineSegments).toEqual(blocks);
  });
});
