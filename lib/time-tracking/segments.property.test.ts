import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays } from '@/lib/date-time/berlin';
import {
  berlinDateArbitrary,
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
/** Every segment here is closed; the open tail's clock is pinned anyway, so no wall clock is read. */
const NOW = new Date('2100-01-01T00:00:00Z');
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

/** Segments of known kinds and minutes that lie inside one Berlin day, so nothing is clipped. */
const inDaySessionArbitrary = fc
  .tuple(
    berlinDateArbitrary,
    fc.integer({ min: 0, max: 300 }),
    fc.array(fc.tuple(fc.constantFrom(...KINDS), fc.integer({ min: 1, max: 120 })), {
      minLength: 1,
      maxLength: 8,
    }),
  )
  .map(([date, offset, parts]) => {
    let cursor = berlinMidnightMs(date) + offset * MINUTE_MS;
    const minutesByKind = new Map<TimeSegmentKind, number>();
    const segments = parts.map(([kind, minutes], index) => {
      const fact = segment(kind, cursor, minutes, index);
      cursor += minutes * MINUTE_MS;
      minutesByKind.set(kind, (minutesByKind.get(kind) ?? 0) + minutes);
      return fact;
    });
    return { date, segments, minutesByKind };
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
          const slices = splitSegmentAtLocalDayBoundaries(fact, wide.start, wide.end, NOW);
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

  test('give each activity of a Berlin day its own minutes, and the day’s presence their sum', () => {
    fc.assert(
      fc.property(inDaySessionArbitrary, ({ date, segments, minutesByKind }) => {
        const dayStart = new Date(berlinMidnightMs(date));
        const dayEnd = new Date(berlinMidnightMs(addLocalDays(date, 1)) - 1);
        const minutes = (kind: TimeSegmentKind): number => minutesByKind.get(kind) ?? 0;
        expect(calculateTimeActivityTotals(segments, dayStart, dayEnd, NOW)).toEqual({
          presenceMinutes: [...minutesByKind.values()].reduce((sum, value) => sum + value, 0),
          workMinutes: minutes('work'),
          breakMinutes: minutes('break'),
          travelMinutes: minutes('travel'),
          standbyMinutes: minutes('standby'),
          calloutMinutes: minutes('callout'),
          internalMinutes: minutes('internal_activity'),
        });
      }),
    );
  });

  test('count only the part of a segment over midnight that falls on the day', () => {
    fc.assert(
      fc.property(
        berlinDateArbitrary,
        fc.constantFrom(...KINDS),
        fc.integer({ min: 1, max: 600 }),
        fc.integer({ min: 1, max: 600 }),
        (date, kind, before, after) => {
          const midnight = berlinMidnightMs(date);
          const fact = segment(kind, midnight - before * MINUTE_MS, before + after, 0);
          const dayStart = new Date(midnight);
          const dayEnd = new Date(berlinMidnightMs(addLocalDays(date, 1)) - 1);
          expect(calculateTimeActivityTotals([fact], dayStart, dayEnd, NOW).presenceMinutes).toBe(after);
        },
      ),
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
          splitSegmentAtLocalDayBoundaries(fact, new Date(0), new Date(8.64e15), NOW).map((slice, index) => ({
            ...fact,
            id: `${fact.id}-${index}`,
            ...slice,
          })),
        );
        expect(calculateTimeActivityTotals(sliced, dayStart, dayEnd, NOW)).toEqual(
          calculateTimeActivityTotals(segments, dayStart, dayEnd, NOW),
        );
      }),
    );
  });
});
