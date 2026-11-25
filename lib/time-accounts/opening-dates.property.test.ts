import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinDateArbitrary, daysInMonth } from '@/lib/testing/berlin-arbitraries';
import { canCorrectOpeningDate, earliestOpeningDate, suggestTimeAccountStartDate } from './opening-dates';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Time accounts": an opening date more than ten years back is refused; an opening date moves
// only while no closed period ends on or after it; the setup proposes the first day of the oldest
// month without a closed period.

const pad = (value: number): string => String(value).padStart(2, '0');

/** The first day of a month as `YYYY-MM-01`. */
const monthStartOf = (localDate: string): string => `${localDate.slice(0, 7)}-01`;

/** The last day of the month a date lies in: a period's end. */
function monthEndOf(localDate: string): string {
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  return `${localDate.slice(0, 7)}-${pad(daysInMonth(year, month))}`;
}

const todayArbitrary = berlinDateArbitrary.filter((date) => date >= '2011-01-01');

describe('The earliest opening date', () => {
  test('is the same calendar day ten years back, the month end when that day does not exist', () => {
    fc.assert(
      fc.property(todayArbitrary, (today) => {
        const year = Number(today.slice(0, 4)) - 10;
        const month = Number(today.slice(5, 7));
        const day = Math.min(Number(today.slice(8, 10)), daysInMonth(year, month));
        expect(earliestOpeningDate(today)).toBe(`${year}-${pad(month)}-${pad(day)}`);
      }),
      { examples: [['2028-02-29']] },
    );
  });
});

describe('An opening date correction', () => {
  test('is allowed exactly while no closed period ends on or after the opening date', () => {
    fc.assert(
      fc.property(
        berlinDateArbitrary,
        fc.option(berlinDateArbitrary.map(monthEndOf), { nil: null }),
        (openedOn, latestClosedPeriodEnd) => {
          expect(canCorrectOpeningDate(openedOn, latestClosedPeriodEnd)).toBe(
            latestClosedPeriodEnd === null || latestClosedPeriodEnd < openedOn,
          );
        },
      ),
    );
  });
});

describe('The proposed start date', () => {
  /** A date `months` whole months from a month's first day, as `YYYY-MM-01`. */
  const monthsFrom = (localDate: string, months: number): string => {
    const index = Number(localDate.slice(0, 4)) * 12 + Number(localDate.slice(5, 7)) - 1 + months;
    return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad((index % 12) + 1)}-01`;
  };

  /**
   * The first month a period can still close that needs an account, found month by month: a month
   * after the last closed period, from the oldest month with recorded time or the current month on.
   */
  function firstEligibleMonth(setup: {
    today: string;
    latestClosedPeriodEnd: string | null;
    earliestActivityDate: string | null;
  }): string {
    const current = monthStartOf(setup.today);
    const firstNeeded =
      setup.earliestActivityDate && monthStartOf(setup.earliestActivityDate) < current
        ? monthStartOf(setup.earliestActivityDate)
        : current;
    let month = firstNeeded;
    while (setup.latestClosedPeriodEnd !== null && month <= setup.latestClosedPeriodEnd)
      month = monthsFrom(month, 1);
    return month;
  }

  // Recorded time and the last close lie on both sides of each other and of today.
  const setupArbitrary = todayArbitrary.chain((today) =>
    fc
      .option(
        // A closed period is a past month at most up to the current one.
        berlinDateArbitrary.filter((date) => date <= today).map(monthEndOf),
        { nil: null },
      )
      .chain((latestClosedPeriodEnd) =>
        fc.record({
          today: fc.constant(today),
          latestClosedPeriodEnd: fc.constant(latestClosedPeriodEnd),
          earliestActivityDate: fc.option(
            fc.oneof(
              berlinDateArbitrary,
              fc
                .tuple(fc.integer({ min: -3, max: 3 }), fc.integer({ min: 0, max: 27 }))
                .map(([months, day]) => {
                  const month = monthsFrom(monthStartOf(latestClosedPeriodEnd ?? today), months);
                  return `${month.slice(0, 8)}${pad(day + 1)}`;
                }),
            ),
            { nil: null },
          ),
        }),
      ),
  );

  test('is the first day of the oldest month after the last close that has recorded time or is current', () => {
    fc.assert(
      fc.property(setupArbitrary, (setup) => {
        expect(suggestTimeAccountStartDate(setup)).toBe(firstEligibleMonth(setup));
      }),
      {
        examples: [
          // Recorded time before the current month, no close: its month, not the current one.
          [{ today: '2026-11-22', latestClosedPeriodEnd: null, earliestActivityDate: '2026-08-14' }],
          // Recorded time starts months after the last close: that month, not the one after the close.
          [{ today: '2026-11-22', latestClosedPeriodEnd: '2026-01-31', earliestActivityDate: '2026-05-03' }],
        ],
      },
    );
  });
});
