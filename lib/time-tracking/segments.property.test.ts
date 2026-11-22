import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays } from '@/lib/date-time/berlin';
import {
  berlinMidnightMs,
  berlinMinuteInstantMsArbitrary,
  berlinOffsetMinutes,
} from '@/lib/testing/berlin-arbitraries';
import {
  calculateTimeActivityTotals,
  createActivitySelection,
  splitSegmentAtLocalDayBoundaries,
  type TimeSegmentFact,
} from './segments';
import type { TimeSegmentKind } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Live capture" and "Targets": live capture records work, travel,
// break, standby, call-out and internal segments; the split at midnight (Europe/Berlin) is display
// only and keeps every minute; the parts of a day add up to its presence.

const MINUTE_MS = 60_000;
const KINDS: TimeSegmentKind[] = ['work', 'travel', 'break', 'standby', 'callout', 'internal_activity'];

const oracleDate = (instant: number): string =>
  new Date(instant + berlinOffsetMinutes(instant) * MINUTE_MS).toISOString().slice(0, 10);

function segment(kind: TimeSegmentKind, startMs: number, minutes: number, index: number): TimeSegmentFact {
  return {
    ...createActivitySelection(kind, kind === 'break' ? null : 'job-1'),
    id: `segment-${index}`,
    sessionId: 'session-1',
    organizationId: 'organization-1',
    employeeRecordId: 'employee-1',
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(startMs + minutes * MINUTE_MS).toISOString(),
  };
}

/** Consecutive closed segments of one session, from a recorded minute. */
const sessionArbitrary = fc
  .tuple(
    berlinMinuteInstantMsArbitrary,
    fc.array(fc.tuple(fc.constantFrom(...KINDS), fc.integer({ min: 1, max: 600 })), {
      minLength: 1,
      maxLength: 8,
    }),
  )
  .map(([start, parts]) => {
    let cursor = start;
    return parts.map(([kind, minutes], index) => {
      const fact = segment(kind, cursor, minutes, index);
      cursor += minutes * MINUTE_MS;
      return fact;
    });
  });

const minutesOf = (slice: { startedAt: string; endedAt: string | null }): number =>
  (Date.parse(slice.endedAt ?? slice.startedAt) - Date.parse(slice.startedAt)) / MINUTE_MS;

describe('A session’s segments', () => {
  test('split at each Berlin midnight into one slice per day that keeps every minute', () => {
    fc.assert(
      fc.property(
        berlinMinuteInstantMsArbitrary,
        fc.integer({ min: 1, max: 3 * 24 * 60 }),
        (start, minutes) => {
          const fact = segment('work', start, minutes, 0);
          const wide = { start: new Date(start - 4 * 86_400_000), end: new Date(start + 8 * 86_400_000) };
          const slices = splitSegmentAtLocalDayBoundaries(fact, wide.start, wide.end);
          expect(slices.reduce((sum, slice) => sum + minutesOf(slice), 0)).toBe(minutes);
          expect(slices[0]?.startedAt).toBe(fact.startedAt);
          expect(slices.at(-1)?.endedAt).toBe(fact.endedAt);
          slices.forEach((slice, index) => {
            const first = Date.parse(slice.startedAt);
            const last = Date.parse(slice.endedAt ?? slice.startedAt) - 1;
            expect(oracleDate(last)).toBe(oracleDate(first));
            if (index > 0) expect(first).toBe(berlinMidnightMs(oracleDate(first)));
            const next = slices[index + 1];
            if (next) expect(oracleDate(Date.parse(next.startedAt))).toBe(addLocalDays(oracleDate(first), 1));
          });
        },
      ),
    );
  });

  test('add up to the presence of a Berlin day, each minute in exactly one part', () => {
    fc.assert(
      fc.property(sessionArbitrary, (segments) => {
        const [first] = segments;
        if (!first) throw new Error('a session has a segment');
        const date = oracleDate(Date.parse(first.startedAt));
        const dayStart = new Date(berlinMidnightMs(date));
        const dayEnd = new Date(berlinMidnightMs(addLocalDays(date, 1)) - 1);
        const totals = calculateTimeActivityTotals(segments, dayStart, dayEnd);
        const parts =
          totals.workMinutes +
          totals.breakMinutes +
          totals.travelMinutes +
          totals.standbyMinutes +
          totals.calloutMinutes +
          totals.internalMinutes;
        expect(parts).toBeCloseTo(totals.presenceMinutes, 9);
        const inDay = segments.reduce((sum, fact) => {
          const from = Math.max(Date.parse(fact.startedAt), dayStart.getTime());
          const to = Math.min(Date.parse(fact.endedAt ?? fact.startedAt), dayEnd.getTime());
          return sum + Math.max(0, to - from) / MINUTE_MS;
        }, 0);
        expect(totals.presenceMinutes).toBeCloseTo(inDay, 9);
      }),
    );
  });

  test('count the same day in total whether whole or split at midnight', () => {
    fc.assert(
      fc.property(sessionArbitrary, (segments) => {
        const [first] = segments;
        if (!first) throw new Error('a session has a segment');
        const date = oracleDate(Date.parse(first.startedAt));
        const dayStart = new Date(berlinMidnightMs(date));
        const dayEnd = new Date(berlinMidnightMs(addLocalDays(date, 1)) - 1);
        const sliced = segments.flatMap((fact) =>
          splitSegmentAtLocalDayBoundaries(fact, new Date(0), new Date(8.64e15)).map((slice, index) => ({
            ...fact,
            id: `${fact.id}-${index}`,
            ...slice,
          })),
        );
        expect(calculateTimeActivityTotals(sliced, dayStart, dayEnd)).toEqual(
          calculateTimeActivityTotals(segments, dayStart, dayEnd),
        );
      }),
    );
  });
});
