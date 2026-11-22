import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinMidnightMs, berlinOffsetMinutes } from '@/lib/testing/berlin-arbitraries';
import {
  activityIntervalsAround,
  berlinMonth,
  type BerlinMonth,
  policyArbitrary,
  yearMonthArbitrary,
} from '@/lib/testing/time-account-arbitraries';
import { calculateEmployeePeriod, roundSecondsToMinutes } from './calculation';
import type {
  DailyTargetInput,
  EmployeePeriodCalculationInput,
  TimeAccountPolicy,
  TimeActivityInterval,
  TimeCreditRule,
} from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Accounts, periods and export": credit rules weight an activity and never change recorded
// minutes; a day follows its own policy version; a period is one Berlin calendar month; the
// balance is the opening balance plus credited time minus the target, plus the account events.

const SECOND_MS = 1_000;
const DAY_MS = 86_400_000;

/** The Berlin date of an instant by the EU rule. */
function oracleDate(instant: number): string {
  return new Date(instant + berlinOffsetMinutes(instant) * 60_000).toISOString().slice(0, 10);
}

const dayAfter = (localDate: string): string =>
  new Date(Date.parse(`${localDate}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/** Every calendar date from one to another, both included. */
function datesFrom(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let date = first; date <= last; date = dayAfter(date)) dates.push(date);
  return dates;
}

/** The recorded seconds of each Berlin date, cut at the midnights the EU rule gives. */
function secondsPerDate(intervals: readonly TimeActivityInterval[]): Map<string, number> {
  const seconds = new Map<string, number>();
  for (const interval of intervals) {
    const start = Date.parse(interval.startedAt);
    const end = Date.parse(interval.endedAt);
    for (let date = oracleDate(start); berlinMidnightMs(date) < end; date = dayAfter(date)) {
      const share = Math.min(end, berlinMidnightMs(dayAfter(date))) - Math.max(start, berlinMidnightMs(date));
      seconds.set(date, (seconds.get(date) ?? 0) + share / SECOND_MS);
    }
  }
  return seconds;
}

/** The recorded seconds between two instants. */
function secondsBetween(intervals: readonly TimeActivityInterval[], from: number, to: number): number {
  return intervals.reduce(
    (total, interval) =>
      total +
      Math.max(
        0,
        Math.min(to, Date.parse(interval.endedAt)) - Math.max(from, Date.parse(interval.startedAt)),
      ) /
        SECOND_MS,
    0,
  );
}

function percentageFor(policy: TimeAccountPolicy, interval: TimeActivityInterval): number | undefined {
  const matches = (rule: TimeCreditRule): boolean =>
    rule.activityKind === interval.activityKind &&
    (rule.activityKind !== 'travel' ||
      (rule.travelRoute === interval.travelRoute && rule.travelRole === interval.travelRole)) &&
    (rule.activityKind !== 'standby' || rule.standbyContext === interval.standbyContext);
  return policy.creditRules.find(matches)?.percentage;
}

function input(
  period: { start: string; end: string },
  overrides: Partial<EmployeePeriodCalculationInput> & Pick<EmployeePeriodCalculationInput, 'policy'>,
): EmployeePeriodCalculationInput {
  return {
    employeeRecordId: 'record-1',
    periodStart: period.start,
    periodEnd: period.end,
    previousBalanceMinutes: 0,
    activityIntervals: [],
    dailyTargets: [],
    accountEvents: [],
    publicHolidayDates: new Set(),
    ...overrides,
  };
}

/** Two consecutive months and activities around the turn between them. */
const monthTurnArbitrary = yearMonthArbitrary.chain(({ year, month }) => {
  const first = berlinMonth(year, month);
  const second = berlinMonth(year, month + 1);
  return fc.record({
    first: fc.constant(first),
    second: fc.constant(second),
    intervals: activityIntervalsAround(berlinMidnightMs(second.start)),
    policy: policyArbitrary,
  });
});

/** A policy without supplement rules, for properties that read no supplement. */
const creditOnly = (policy: TimeAccountPolicy): TimeAccountPolicy => ({ ...policy, supplementRules: [] });

const targetsArbitrary = (months: readonly BerlinMonth[]): fc.Arbitrary<DailyTargetInput[]> => {
  const dates = months.flatMap((month) => datesFrom(month.start, month.end));
  // One target per weekday position keeps the draw small; a month still mixes them.
  return fc.array(fc.integer({ min: 0, max: 600 }), { minLength: 7, maxLength: 7 }).map((minutes) =>
    dates.map((localDate, index) => ({
      localDate,
      targetMinutes: minutes[index % 7] ?? 0,
      source: 'schedule' as const,
      vacationMinutes: 0,
      sicknessMinutes: 0,
      schoolMinutes: 0,
    })),
  );
};

const accountEventsArbitrary = (months: readonly BerlinMonth[]) => {
  const dates = months.flatMap((month) => datesFrom(month.start, month.end));
  return fc.array(
    fc.record({
      id: fc.uuid(),
      kind: fc.constantFrom(
        'opening_balance' as const,
        'manual_adjustment' as const,
        'expiry' as const,
        'payout' as const,
      ),
      effectiveDate: fc.constantFrom(...dates),
      minutes: fc.integer({ min: -6_000, max: 6_000 }),
    }),
    { maxLength: 6 },
  );
};

describe('Rounding recorded seconds to minutes', () => {
  test('gives the nearest whole minute, a half minute up, and the seconds it moved', () => {
    fc.assert(
      // Recorded time is whole milliseconds, credited at 0, 50 or 100 percent.
      fc.property(fc.integer({ min: 0, max: 4_000_000_000 }), (halfMilliseconds) => {
        const seconds = halfMilliseconds / 2_000;
        const { minutes, roundingDeltaSeconds } = roundSecondsToMinutes(seconds);
        expect(Number.isInteger(minutes)).toBe(true);
        expect(minutes * 60 - 30).toBeLessThanOrEqual(seconds);
        expect(seconds).toBeLessThan(minutes * 60 + 30);
        expect(roundingDeltaSeconds).toBeCloseTo(minutes * 60 - seconds, 6);
      }),
      { examples: [[59_000], [60_000], [59_999]] },
    );
  });
});

describe('A period calculation', () => {
  test('splits recorded time at Berlin midnights, gives each day to one month, and adds up per month', () => {
    fc.assert(
      fc.property(monthTurnArbitrary, ({ first, second, intervals, policy }) => {
        const calculate = (period: { start: string; end: string }) =>
          calculateEmployeePeriod(input(period, { policy, activityIntervals: intervals }));
        // The drawn activities lie well inside the two months around the turn.
        const both = calculate({ start: first.start, end: second.end });
        const perDate = new Map<string, number>();
        for (const bucket of both.activityBuckets)
          perDate.set(bucket.localDate, (perDate.get(bucket.localDate) ?? 0) + bucket.sourceSeconds);
        const expected = secondsPerDate(intervals);
        expect([...perDate.keys()].sort()).toEqual([...expected.keys()].sort());
        for (const [date, seconds] of expected) expect(perDate.get(date)).toBeCloseTo(seconds, 6);

        const months = [first, second].map((month) => ({ month, result: calculate(month) }));
        for (const { month, result } of months) {
          const seconds = result.activityBuckets.reduce((total, bucket) => total + bucket.sourceSeconds, 0);
          expect(seconds).toBeCloseTo(
            secondsBetween(intervals, berlinMidnightMs(month.start), berlinMidnightMs(month.endExclusive)),
            6,
          );
          for (const bucket of result.activityBuckets)
            expect(bucket.localDate.slice(0, 7)).toBe(month.start.slice(0, 7));
        }
        expect(months.flatMap(({ result }) => result.activityBuckets)).toEqual([...both.activityBuckets]);
        expect(months.flatMap(({ result }) => result.supplementBuckets)).toEqual([...both.supplementBuckets]);
      }),
    );
  });

  test('credits 0, 50 or 100 percent by the rule of the activity and never changes recorded minutes', () => {
    fc.assert(
      fc.property(monthTurnArbitrary, policyArbitrary, ({ first, intervals, policy }, otherPolicy) => {
        const [result, other] = [policy, otherPolicy].map((credit) =>
          calculateEmployeePeriod(input(first, { policy: creditOnly(credit), activityIntervals: intervals })),
        );
        if (!result || !other) throw new Error('two calculations expected');
        const recorded = (buckets: typeof result.activityBuckets) =>
          buckets.map(({ localDate, activityKind, sourceSeconds, sourceMinutes, sourceIds }) => ({
            localDate,
            activityKind,
            sourceSeconds,
            sourceMinutes,
            sourceIds,
          }));
        expect(recorded(other.activityBuckets)).toEqual(recorded(result.activityBuckets));
        expect(other.sourceMinutes).toBe(result.sourceMinutes);
        for (const bucket of result.activityBuckets) {
          const source = intervals.find((interval) => interval.sourceId === bucket.sourceIds[0]);
          expect(source && percentageFor(policy, source)).toBe(bucket.percentage);
          expect(bucket.creditedSeconds).toBeCloseTo((bucket.sourceSeconds * bucket.percentage) / 100, 6);
          if (bucket.percentage === 0) expect(bucket.creditedMinutes).toBe(0);
          if (bucket.percentage === 100) expect(bucket.creditedMinutes).toBe(bucket.sourceMinutes);
          expect(Math.abs(bucket.creditedMinutes * 60 - bucket.creditedSeconds)).toBeLessThanOrEqual(30);
        }
      }),
    );
  });

  test('credits each day by the policy version of that day, also for time over midnight', () => {
    fc.assert(
      fc.property(
        monthTurnArbitrary,
        policyArbitrary,
        fc.array(fc.boolean(), { minLength: 70, maxLength: 70 }),
        ({ first, second, intervals, policy }, otherPolicy, choices) => {
          const dates = datesFrom(first.start, second.end);
          const policyByDate = new Map(
            dates.map((date, index) => [date, creditOnly(choices[index] ? otherPolicy : policy)] as const),
          );
          const result = calculateEmployeePeriod(
            input(
              { start: first.start, end: second.end },
              { policy: creditOnly(policy), policyByDate, activityIntervals: intervals },
            ),
          );
          for (const bucket of result.activityBuckets) {
            const source = intervals.find((interval) => interval.sourceId === bucket.sourceIds[0]);
            const dayPolicy = policyByDate.get(bucket.localDate);
            expect(source && dayPolicy && percentageFor(dayPolicy, source)).toBe(bucket.percentage);
          }
        },
      ),
    );
  });

  test('does not depend on the order of the recorded activities', () => {
    fc.assert(
      fc.property(
        monthTurnArbitrary.chain((drawn) =>
          fc.record({
            drawn: fc.constant(drawn),
            shuffled: fc.shuffledSubarray(drawn.intervals, { minLength: drawn.intervals.length }),
          }),
        ),
        ({ drawn: { first, intervals, policy }, shuffled }) => {
          expect(calculateEmployeePeriod(input(first, { policy, activityIntervals: shuffled }))).toEqual(
            calculateEmployeePeriod(input(first, { policy, activityIntervals: intervals })),
          );
        },
      ),
    );
  });
});

describe('The Zeitkonto balance of a period', () => {
  const balanceArbitrary = monthTurnArbitrary.chain((drawn) =>
    fc.record({
      drawn: fc.constant(drawn),
      targets: targetsArbitrary([drawn.first, drawn.second]),
      events: accountEventsArbitrary([drawn.first, drawn.second]),
      opening: fc.integer({ min: -60_000, max: 60_000 }),
    }),
  );

  test('is the opening balance plus credited time minus the target plus the events, and opens the next month', () => {
    fc.assert(
      fc.property(
        balanceArbitrary,
        ({ drawn: { first, second, intervals, policy }, targets, events, opening }) => {
          const calculate = (period: { start: string; end: string }, previousBalanceMinutes: number) =>
            calculateEmployeePeriod(
              input(period, {
                policy: creditOnly(policy),
                activityIntervals: intervals,
                dailyTargets: targets,
                accountEvents: events,
                previousBalanceMinutes,
              }),
            );
          const result = calculate(first, opening);
          const inMonth = (date: string): boolean => date >= first.start && date <= first.end;
          const target = targets
            .filter((day) => inMonth(day.localDate))
            .reduce((sum, day) => sum + day.targetMinutes, 0);
          const eventMinutes = events
            .filter((event) => inMonth(event.effectiveDate))
            .reduce((sum, event) => sum + event.minutes, 0);
          const credited = result.activityBuckets.reduce((sum, bucket) => sum + bucket.creditedMinutes, 0);
          expect(result.targetMinutes).toBe(target);
          expect(result.creditedMinutes).toBe(credited);
          // The period stores the opening, the events and the month's change beside the balance.
          expect(result.previousBalanceMinutes).toBe(opening);
          expect(result.accountEventMinutes).toBe(eventMinutes);
          expect(result.periodDeltaMinutes).toBe(credited - target + eventMinutes);
          expect(result.closingBalanceMinutes).toBe(opening + credited - target + eventMinutes);
          expect(result.overtimeCandidateMinutes).toBe(Math.max(0, credited - target));
          expect(calculate(second, result.closingBalanceMinutes).closingBalanceMinutes).toBe(
            calculate({ start: first.start, end: second.end }, opening).closingBalanceMinutes,
          );
        },
      ),
    );
  });

  test('is unchanged by an adjustment and its cancellation, and by an event of another month', () => {
    fc.assert(
      fc.property(
        balanceArbitrary,
        fc.integer({ min: 1, max: 6_000 }),
        fc.integer({ min: 0, max: 27 }),
        // Recorded time only adds credited minutes, so it stays out of this property.
        ({ drawn: { first, second, policy }, targets, events, opening }, minutes, day) => {
          const calculate = (accountEvents: EmployeePeriodCalculationInput['accountEvents']) =>
            calculateEmployeePeriod(
              input(first, {
                policy,
                dailyTargets: targets,
                accountEvents,
                previousBalanceMinutes: opening,
              }),
            ).closingBalanceMinutes;
          const date = datesFrom(first.start, first.end)[day] ?? first.start;
          const otherDate = datesFrom(second.start, second.end)[day] ?? second.start;
          expect(
            calculate([
              ...events,
              { id: 'adjustment', kind: 'manual_adjustment', effectiveDate: date, minutes },
              { id: 'cancellation', kind: 'manual_adjustment', effectiveDate: date, minutes: -minutes },
              { id: 'next-month', kind: 'payout', effectiveDate: otherDate, minutes: -minutes },
            ]),
          ).toBe(calculate(events));
        },
      ),
    );
  });
});
