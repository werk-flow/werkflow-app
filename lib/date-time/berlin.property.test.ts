import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  berlinDateArbitrary,
  berlinDayLengthHours,
  berlinInstantMsArbitrary,
  berlinMinuteInstantMsArbitrary,
  berlinOffsetMinutes,
  berlinTransitions,
  berlinWallTimeArbitrary,
  daysInMonth,
} from '@/lib/testing/berlin-arbitraries';
import {
  addLocalDays,
  addLocalMonths,
  addLocalMonthsClamped,
  formatBerlinDateTimeInput,
  formatBerlinLocalDate,
  formatBerlinLocalDateTime,
  getLocalDayEnd,
  getLocalDayStart,
  getLocalWeekday,
  isSameLocalDay,
  parseBerlinDateTimeInput,
  resolveBerlinWallTime,
  splitTimedIntervalByBerlinDate,
} from './berlin';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md and calendar-and-resource-planning.md: a business date is the
// Berlin date, a period is a Berlin calendar month, and time over midnight splits at 00:00 Berlin.

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** The Berlin wall time of an instant by the EU rule, without Intl. */
function oracleWallTime(instant: number): string {
  return new Date(instant + berlinOffsetMinutes(instant) * MINUTE_MS).toISOString().slice(0, 16);
}

/** Whether a wall time lies in the hour that the spring switch skips. */
function inSpringGap(wallTime: string): boolean {
  const { springForward } = berlinTransitions(Number(wallTime.slice(0, 4)));
  return (
    wallTime.slice(0, 10) === oracleWallTime(springForward).slice(0, 10) && wallTime.slice(11, 13) === '02'
  );
}

/** Whether a wall time lies in the hour that the autumn switch repeats. */
function inAutumnOverlap(wallTime: string): boolean {
  const { fallBack } = berlinTransitions(Number(wallTime.slice(0, 4)));
  return wallTime.slice(0, 10) === oracleWallTime(fallBack).slice(0, 10) && wallTime.slice(11, 13) === '02';
}

const intervalArbitrary = fc
  .tuple(berlinMinuteInstantMsArbitrary, fc.integer({ min: 1, max: 4 * 24 * 60 }))
  .map(([start, minutes]) => ({ start, end: start + minutes * MINUTE_MS }));

describe('Berlin wall time of an instant', () => {
  test('is UTC plus one hour in winter and two in summer, switching at 01:00 UTC', () => {
    fc.assert(
      fc.property(berlinInstantMsArbitrary, (instant) => {
        expect(formatBerlinLocalDateTime(new Date(instant))).toBe(oracleWallTime(instant));
      }),
      { examples: [[Date.parse('2026-12-31T23:30:00Z')], [Date.parse('2027-03-28T01:00:00Z')]] },
    );
  });

  test('gives the business date of the year turn in Berlin, not in UTC', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2098 }), fc.integer({ min: 0, max: 59 }), (year, minute) => {
        const instant = new Date(Date.UTC(year, 11, 31, 23, minute));
        expect(formatBerlinLocalDate(instant)).toBe(`${year + 1}-01-01`);
      }),
    );
  });

  test('renders the same wall time for a date input as for display', () => {
    fc.assert(
      fc.property(berlinInstantMsArbitrary, (instant) => {
        expect(formatBerlinDateTimeInput(new Date(instant))).toBe(
          formatBerlinLocalDateTime(new Date(instant)),
        );
      }),
    );
  });
});

describe('A Berlin day', () => {
  test('has a start and an end on its own date, also on DST days', () => {
    fc.assert(
      fc.property(berlinInstantMsArbitrary, (instant) => {
        const date = new Date(instant);
        const start = getLocalDayStart(date);
        const end = getLocalDayEnd(date);
        const localDate = formatBerlinLocalDate(date);
        expect(start.getTime()).toBeLessThanOrEqual(instant);
        expect(end.getTime()).toBeGreaterThanOrEqual(instant);
        expect(formatBerlinLocalDateTime(start)).toBe(`${localDate}T00:00`);
        expect(formatBerlinLocalDate(end)).toBe(localDate);
        expect(formatBerlinLocalDate(new Date(end.getTime() + 1))).toBe(addLocalDays(localDate, 1));
        expect(getLocalDayStart(new Date(end.getTime() + 1)).getTime()).toBe(end.getTime() + 1);
      }),
    );
  });

  test('lasts 23 hours on the spring switch, 25 on the autumn switch and 24 otherwise', () => {
    fc.assert(
      fc.property(berlinInstantMsArbitrary, (instant) => {
        const date = new Date(instant);
        const length = getLocalDayEnd(date).getTime() + 1 - getLocalDayStart(date).getTime();
        expect(length).toBe(berlinDayLengthHours(formatBerlinLocalDate(date)) * HOUR_MS);
      }),
    );
  });

  test('is the same day for two instants exactly when their business dates match', () => {
    fc.assert(
      fc.property(
        berlinInstantMsArbitrary,
        fc.integer({ min: -26 * HOUR_MS, max: 26 * HOUR_MS }),
        (instant, shift) => {
          const left = new Date(instant);
          const right = new Date(instant + shift);
          expect(isSameLocalDay(left, right)).toBe(
            formatBerlinLocalDate(left) === formatBerlinLocalDate(right),
          );
        },
      ),
    );
  });
});

describe('Time over midnight split by Berlin date', () => {
  test('keeps every minute and gives each date its own share in date order', () => {
    fc.assert(
      fc.property(intervalArbitrary, ({ start, end }) => {
        const shares = splitTimedIntervalByBerlinDate(new Date(start), new Date(end));
        expect(shares.reduce((sum, share) => sum + share.minutes, 0)).toBe((end - start) / MINUTE_MS);
        expect(shares[0]?.localDate).toBe(formatBerlinLocalDate(new Date(start)));
        expect(shares.at(-1)?.localDate).toBe(formatBerlinLocalDate(new Date(end - 1)));
        shares.forEach((share, index) => {
          expect(share.minutes).toBeGreaterThan(0);
          expect(share.minutes).toBeLessThanOrEqual(berlinDayLengthHours(share.localDate) * 60);
          const previous = shares[index - 1];
          if (previous) expect(share.localDate).toBe(addLocalDays(previous.localDate, 1));
        });
      }),
    );
  });

  test('is empty for an interval that does not move forward', () => {
    fc.assert(
      fc.property(berlinInstantMsArbitrary, fc.nat({ max: 48 * HOUR_MS }), (start, back) => {
        expect(splitTimedIntervalByBerlinDate(new Date(start), new Date(start - back))).toEqual([]);
      }),
    );
  });
});

describe('A typed Berlin wall time', () => {
  test('resolves for planning to an instant that shows it, the first of two in autumn, or the next valid time in spring', () => {
    fc.assert(
      fc.property(berlinWallTimeArbitrary, (wallTime) => {
        const resolved = resolveBerlinWallTime(wallTime);
        expect(resolved).not.toBeNull();
        if (!resolved) return;
        const instant = resolved.instant.getTime();
        expect(oracleWallTime(instant)).toBe(resolved.localDateTime);
        if (inSpringGap(wallTime)) {
          expect(resolved.resolution).toBe('shifted_forward');
          expect(resolved.localDateTime).toBe(oracleWallTime(Date.parse(`${wallTime}:00Z`) - HOUR_MS));
        } else if (inAutumnOverlap(wallTime)) {
          expect(resolved).toMatchObject({ resolution: 'first_ambiguous', localDateTime: wallTime });
          expect(oracleWallTime(instant + HOUR_MS)).toBe(wallTime);
        } else {
          expect(resolved).toMatchObject({ resolution: 'exact', localDateTime: wallTime });
        }
      }),
    );
  });

  test('parses for a form to the later of two autumn instants, and to nothing in the spring gap', () => {
    fc.assert(
      fc.property(berlinWallTimeArbitrary, (wallTime) => {
        const parsed = parseBerlinDateTimeInput(wallTime);
        if (inSpringGap(wallTime)) return expect(parsed).toBeNull();
        expect(parsed).not.toBeNull();
        if (!parsed) return;
        expect(oracleWallTime(parsed.getTime())).toBe(wallTime);
        expect(oracleWallTime(parsed.getTime() + HOUR_MS)).not.toBe(wallTime);
      }),
    );
  });

  test('round-trips a recorded minute through display and input', () => {
    fc.assert(
      fc.property(berlinMinuteInstantMsArbitrary, (instant) => {
        const wallTime = formatBerlinLocalDateTime(new Date(instant));
        expect([instant, instant + HOUR_MS]).toContain(
          parseBerlinDateTimeInput(wallTime)?.getTime() ?? Number.NaN,
        );
        expect([instant, instant - HOUR_MS]).toContain(
          resolveBerlinWallTime(wallTime)?.instant.getTime() ?? Number.NaN,
        );
      }),
    );
  });

  test('is no instant when it names no real date', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 29, max: 31 }),
        (year, month, day) => {
          fc.pre(day > daysInMonth(year, month));
          const wallTime = `${year}-${String(month).padStart(2, '0')}-${day}T09:00`;
          expect(parseBerlinDateTimeInput(wallTime)).toBeNull();
          expect(resolveBerlinWallTime(wallTime)).toBeNull();
        },
      ),
    );
  });
});

describe('Calendar arithmetic on Berlin dates', () => {
  test('adds days so that steps compose, undo each other and move the weekday along', () => {
    fc.assert(
      fc.property(
        berlinDateArbitrary,
        fc.integer({ min: -800, max: 800 }),
        fc.integer({ min: -800, max: 800 }),
        (date, first, second) => {
          expect(addLocalDays(addLocalDays(date, first), second)).toBe(addLocalDays(date, first + second));
          expect(addLocalDays(addLocalDays(date, first), -first)).toBe(date);
          const weekday = getLocalWeekday(addLocalDays(date, first));
          expect(weekday).toBe((((getLocalWeekday(date) + first) % 7) + 7) % 7);
        },
      ),
    );
  });

  test('turns the month and the year on the day after the last', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2099 }), fc.integer({ min: 1, max: 12 }), (year, month) => {
        const last = `${year}-${String(month).padStart(2, '0')}-${daysInMonth(year, month)}`;
        const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
        expect(addLocalDays(last, 1)).toBe(next);
        expect(addLocalDays(next, -1)).toBe(last);
      }),
    );
  });

  test('adds months on the same day, or none when the month is too short, or clamps to its end', () => {
    fc.assert(
      fc.property(berlinDateArbitrary, fc.integer({ min: -36, max: 36 }), (date, months) => {
        const [year, month, day] = date.split('-').map(Number);
        if (year === undefined || month === undefined || day === undefined) throw new Error('unparsed date');
        const target = year * 12 + (month - 1) + months;
        const targetYear = Math.floor(target / 12);
        const targetMonth = (target % 12) + 1;
        const lastDay = daysInMonth(targetYear, targetMonth);
        const prefix = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
        const exact = addLocalMonths(date, months);
        expect(exact).toBe(day > lastDay ? null : `${prefix}-${String(day).padStart(2, '0')}`);
        expect(addLocalMonthsClamped(date, months)).toBe(
          `${prefix}-${String(Math.min(day, lastDay)).padStart(2, '0')}`,
        );
      }),
    );
  });

  test('refuses a weekday for a date that does not exist', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2099 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 29, max: 31 }),
        (year, month, day) => {
          fc.pre(day > daysInMonth(year, month));
          expect(() => getLocalWeekday(`${year}-${String(month).padStart(2, '0')}-${day}`)).toThrow(
            'invalid_local_date',
          );
        },
      ),
    );
  });
});
