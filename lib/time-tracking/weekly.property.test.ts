import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { addLocalDays, getLocalWeekday } from '@/lib/date-time/berlin';
import { berlinDateArbitrary, berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { RECORDED_DAY_CLOCK, type RecordedDay, recordedDayOn } from '@/lib/testing/time-entry-arbitraries';
import type { DailyTarget } from '@/lib/personnel/targets';
import type { BreakPolicy } from './settings';
import { buildWeeklyTimeData } from './weekly';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Targets" and "Break rule": each Berlin day of the week shows
// presence, work, break and overtime against its target; overtime is the work beyond the target;
// a manual rule counts the stamped breaks; the week is the Berlin calendar week, DST weeks included.

beforeAll(() => setSystemTime(RECORDED_DAY_CLOCK));
afterAll(() => setSystemTime());

const MANUAL: BreakPolicy = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
  breakPolicyHistory: [],
};

/** A Berlin week before the pinned clock, with some of its days recorded and a target per day. */
const weekArbitrary = berlinDateArbitrary
  .filter((date) => date < '2026-11-01')
  .map((date) => addLocalDays(date, -getLocalWeekday(date)))
  .chain((monday) =>
    fc.record({
      monday: fc.constant(monday),
      days: fc.tuple(
        ...Array.from({ length: 7 }, (_, index) =>
          fc.option(recordedDayOn(addLocalDays(monday, index)), { nil: null }),
        ),
      ),
      targets: fc.array(fc.integer({ min: 0, max: 600 }), { minLength: 7, maxLength: 7 }),
    }),
  );

const targetsOf = (dates: string[], minutes: number[]): DailyTarget[] =>
  dates.map((date, index) => ({
    date,
    weekday: index,
    targetMinutes: minutes[index] ?? 0,
    baseTargetMinutes: minutes[index] ?? 0,
    source: 'schedule',
    outsideEmployment: null,
    isHoliday: false,
    holidayName: null,
    isClosureDay: false,
    closureLabel: null,
    absence: null,
  }));

describe('A week of recorded time', () => {
  test('puts each Berlin day’s time on that day and splits its work at the target into work and overtime', () => {
    fc.assert(
      fc.property(weekArbitrary, ({ monday, days, targets }) => {
        const entries = days.flatMap((day: RecordedDay | null) => day?.entries ?? []);
        const dates = Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
        const week = buildWeeklyTimeData(
          entries,
          new Date(berlinMidnightMs(monday)),
          MANUAL,
          targetsOf(dates, targets),
        );
        expect(week.map((point) => point.date)).toEqual(dates);
        week.forEach((point, index) => {
          const day = days[index] ?? null;
          const work = day?.workMinutes ?? 0;
          const target = targets[index] ?? 0;
          expect(point.breakMinutes).toBe(day?.breakMinutes ?? 0);
          expect(point.totalMinutes).toBe(work + (day?.breakMinutes ?? 0));
          expect(point.overtimeMinutes).toBe(Math.max(0, work - target));
          expect(point.workMinutes + point.overtimeMinutes).toBe(work);
        });
      }),
    );
  });
});
