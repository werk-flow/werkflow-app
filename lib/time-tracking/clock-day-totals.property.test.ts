import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays } from '@/lib/date-time/berlin';
import {
  berlinDateArbitrary,
  berlinMidnightMs,
  berlinMinuteInstantMsArbitrary,
  berlinOffsetMinutes,
} from '@/lib/testing/berlin-arbitraries';
import { projectedTransitionEntries } from './canonical-entries';
import { clockDayTotals, type ClockDayTotals } from './clock-day-totals';
import { createActivitySelection, splitSegmentAtLocalDayBoundaries, type TimeSegmentFact } from './segments';
import type { BreakPolicy } from './settings';
import type { TimeEntry, TimeSegmentKind, WeeklyTimeDataPoint } from './types';
import { buildWeeklyTimeData, getWeekBounds } from './weekly';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Live capture" and "Targets": live capture records work, travel,
// break, standby, call-out and internal segments; the split at midnight (Europe/Berlin) is display
// only and keeps every minute; the parts of a day add up to its presence. Today's clock
// (`clockDayTotals`) and the week (`buildWeeklyTimeData`) count a day from the segments'
// transitions projected into their window (`projectedTransitionEntries`).

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

afterEach(() => setSystemTime());

/** The day's own counts, before the break rule; the week reads them under a manual rule. */
type DayCounts = Pick<
  ClockDayTotals,
  | 'presenceMinutes'
  | 'breakMinutes'
  | 'travelMinutes'
  | 'standbyMinutes'
  | 'calloutMinutes'
  | 'internalMinutes'
>;

const MANUAL_RULE: BreakPolicy = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [],
};

/** The segments' transitions inside a window, as the clock state and the week read them. */
function entriesIn(segments: readonly TimeSegmentFact[], from: Date, to: Date): TimeEntry[] {
  const rows = segments.map((fact) => ({
    row: { created_at: fact.startedAt, updated_at: fact.startedAt },
    segment: fact,
  }));
  return projectedTransitionEntries(rows, new Map([['employee-1', 'user-1']]), { from, to, now: to });
}

/** The clock's totals of a Berlin day, read at its last instant: the clock counts today only. */
function clockDay(segments: readonly TimeSegmentFact[], date: string): ClockDayTotals {
  const dayStart = new Date(berlinMidnightMs(date));
  const dayEnd = new Date(berlinMidnightMs(addLocalDays(date, 1)) - 1);
  const entries = entriesIn(segments, dayStart, dayEnd);
  setSystemTime(dayEnd);
  return clockDayTotals(entries, dayEnd);
}

/** The week around a Berlin day, read once it has ended. */
function weekOf(segments: readonly TimeSegmentFact[], date: string): WeeklyTimeDataPoint[] {
  const { monday, sunday } = getWeekBounds(new Date(berlinMidnightMs(date)));
  const entries = entriesIn(segments, monday, sunday);
  setSystemTime(sunday);
  return buildWeeklyTimeData(entries, monday, MANUAL_RULE);
}

/** The day's counts as the clock and as the week count them. */
function countsOf(segments: readonly TimeSegmentFact[], date: string): { clock: DayCounts; week: DayCounts } {
  const { presenceMinutes, breakMinutes, travelMinutes, standbyMinutes, calloutMinutes, internalMinutes } =
    clockDay(segments, date);
  const day = weekOf(segments, date).find((point) => point.date === date);
  if (!day) throw new Error('the week holds the day');
  return {
    clock: { presenceMinutes, breakMinutes, travelMinutes, standbyMinutes, calloutMinutes, internalMinutes },
    week: {
      presenceMinutes: day.totalMinutes,
      breakMinutes: day.breakMinutes,
      travelMinutes: day.travelMinutes ?? 0,
      standbyMinutes: day.standbyMinutes ?? 0,
      calloutMinutes: day.calloutMinutes ?? 0,
      internalMinutes: day.internalMinutes ?? 0,
    },
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

describe('A day’s totals on the clock and in the week, counted from its projected transitions', () => {
  test('give each activity of a Berlin day its own minutes, and the day’s presence their sum', () => {
    fc.assert(
      fc.property(inDaySessionArbitrary, ({ date, segments, minutesByKind }) => {
        const minutes = (kind: TimeSegmentKind): number => minutesByKind.get(kind) ?? 0;
        const expected: DayCounts = {
          presenceMinutes: [...minutesByKind.values()].reduce((sum, value) => sum + value, 0),
          breakMinutes: minutes('break'),
          travelMinutes: minutes('travel'),
          standbyMinutes: minutes('standby'),
          calloutMinutes: minutes('callout'),
          internalMinutes: minutes('internal_activity'),
        };
        const { clock, week } = countsOf(segments, date);
        expect(clock).toEqual(expected);
        expect(week).toEqual(expected);
        const {
          presenceMinutes,
          breakMinutes,
          travelMinutes,
          standbyMinutes,
          calloutMinutes,
          internalMinutes,
        } = clock;
        expect(
          presenceMinutes - breakMinutes - travelMinutes - standbyMinutes - calloutMinutes - internalMinutes,
        ).toBe(minutes('work'));
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
          const fact = segment(kind, berlinMidnightMs(date) - before * MINUTE_MS, before + after, 0);
          const { clock, week } = countsOf([fact], date);
          expect(clock.presenceMinutes).toBe(after);
          expect(week.presenceMinutes).toBe(after);
        },
      ),
    );
  });

  test('count the same day whether its segments come whole or split at midnight', () => {
    fc.assert(
      fc.property(sessionArbitrary, (segments) => {
        const [first] = segments;
        if (!first) throw new Error('a session has a segment');
        const date = oracleDate(Date.parse(first.startedAt));
        const sliced = segments.flatMap((fact) =>
          splitSegmentAtLocalDayBoundaries(fact, new Date(0), new Date(8.64e15), new Date(8.64e15)).map(
            (slice, index) => ({ ...fact, id: `${fact.id}-${index}`, ...slice }),
          ),
        );
        expect(clockDay(sliced, date)).toEqual(clockDay(segments, date));
        expect(weekOf(sliced, date)).toEqual(weekOf(segments, date));
      }),
    );
  });
});
