import fc from 'fast-check';

/**
 * Inputs for property tests of Berlin dates and instants, and an oracle that knows the Berlin
 * offset without Intl: the EU rule in force since 1996 starts summer time at 01:00 UTC on the last
 * Sunday of March and ends it at 01:00 UTC on the last Sunday of October. The oracle never calls
 * the module under test, so a property that compares the two catches a wrong zone, a wrong
 * transition hour and a date that turns on the UTC clock instead of the Berlin one.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const FIRST_YEAR = 2000;
const LAST_YEAR = 2099;

/** The last Sunday of a month (0-based) as a UTC date at midnight. */
function lastSundayUtc(year: number, monthIndex: number): number {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0));
  return lastDay.getTime() - lastDay.getUTCDay() * DAY_MS;
}

/** The UTC instants at which Berlin summer time starts and ends in a year. */
export function berlinTransitions(year: number): { springForward: number; fallBack: number } {
  return {
    springForward: lastSundayUtc(year, 2) + HOUR_MS,
    fallBack: lastSundayUtc(year, 9) + HOUR_MS,
  };
}

/** Berlin's offset from UTC at an instant, in minutes, by the EU rule. */
export function berlinOffsetMinutes(instant: number): 60 | 120 {
  const { springForward, fallBack } = berlinTransitions(new Date(instant).getUTCFullYear());
  return instant >= springForward && instant < fallBack ? 120 : 60;
}

/** `YYYY-MM-DD` of a UTC midnight. */
function isoDate(utcMidnight: number): string {
  return new Date(utcMidnight).toISOString().slice(0, 10);
}

/** The number of days of a month (1-based). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Whether a Berlin date is the 23-hour spring day or the 25-hour autumn day. */
export function berlinDayLengthHours(localDate: string): 23 | 24 | 25 {
  const midnight = Date.parse(`${localDate}T00:00:00Z`);
  const { springForward, fallBack } = berlinTransitions(new Date(midnight).getUTCFullYear());
  if (midnight === springForward - HOUR_MS) return 23;
  if (midnight === fallBack - HOUR_MS) return 25;
  return 24;
}

const yearArbitrary = fc.integer({ min: FIRST_YEAR, max: LAST_YEAR });

/** Any calendar date from 2000 to 2099 as `YYYY-MM-DD`. */
const localDateArbitrary: fc.Arbitrary<string> = fc
  .integer({ min: Date.UTC(FIRST_YEAR, 0, 1) / DAY_MS, max: Date.UTC(LAST_YEAR, 11, 31) / DAY_MS })
  .map((day) => isoDate(day * DAY_MS));

/** A date that turns a month, a year or a DST day, where date arithmetic breaks first. */
const edgeDateArbitrary: fc.Arbitrary<string> = fc.oneof(
  fc
    .tuple(yearArbitrary, fc.integer({ min: 1, max: 12 }))
    .map(([year, month]) => isoDate(Date.UTC(year, month, 0))),
  yearArbitrary.map((year) => `${year}-01-01`),
  yearArbitrary.map((year) => isoDate(berlinTransitions(year).springForward - HOUR_MS)),
  yearArbitrary.map((year) => isoDate(berlinTransitions(year).fallBack - HOUR_MS)),
  yearArbitrary.filter((year) => daysInMonth(year, 2) === 29).map((year) => `${year}-02-29`),
);

/** Calendar dates with month ends, year turns, leap days and DST days drawn often. */
export const berlinDateArbitrary: fc.Arbitrary<string> = fc.oneof(localDateArbitrary, edgeDateArbitrary);

/** Any instant from 2000 to 2099, to the millisecond. */
const uniformInstantArbitrary = fc.integer({
  min: Date.UTC(FIRST_YEAR, 0, 1),
  max: Date.UTC(LAST_YEAR, 11, 31, 23, 59, 59, 999),
});

/** Within three hours of a DST switch. */
const nearTransitionArbitrary = fc
  .tuple(yearArbitrary, fc.boolean(), fc.integer({ min: -3 * HOUR_MS, max: 3 * HOUR_MS }))
  .map(([year, spring, offset]) => {
    const { springForward, fallBack } = berlinTransitions(year);
    return (spring ? springForward : fallBack) + offset;
  });

/** Within three hours of a Berlin midnight, the year turn included. */
const nearMidnightArbitrary = fc
  .tuple(berlinDateArbitrary, fc.integer({ min: -3 * HOUR_MS, max: 3 * HOUR_MS }))
  .map(([localDate, offset]) => {
    const utcMidnight = Date.parse(`${localDate}T00:00:00Z`);
    return utcMidnight - berlinOffsetMinutes(utcMidnight - HOUR_MS) * MINUTE_MS + offset;
  });

/** Instants in milliseconds, with DST switches and Berlin midnights drawn often. */
export const berlinInstantMsArbitrary: fc.Arbitrary<number> = fc.oneof(
  uniformInstantArbitrary,
  nearTransitionArbitrary,
  nearMidnightArbitrary,
);

/** Instants on a whole minute, as recorded time is entered. */
export const berlinMinuteInstantMsArbitrary: fc.Arbitrary<number> = berlinInstantMsArbitrary.map(
  (instant) => Math.floor(instant / MINUTE_MS) * MINUTE_MS,
);

/** A Berlin wall time `YYYY-MM-DDTHH:MM`, the spring gap and the autumn overlap drawn often. */
export const berlinWallTimeArbitrary: fc.Arbitrary<string> = fc
  .tuple(
    berlinDateArbitrary,
    fc.oneof(fc.integer({ min: 0, max: 23 }), fc.constantFrom(1, 2, 3)),
    fc.integer({ min: 0, max: 59 }),
  )
  .map(
    ([localDate, hour, minute]) =>
      `${localDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  );
