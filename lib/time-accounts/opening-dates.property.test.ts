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

const monthBefore = (localDate: string): string => {
  const year = Number(localDate.slice(0, 4));
  const month = Number(localDate.slice(5, 7));
  return month === 1 ? `${year - 1}-12-01` : `${year}-${pad(month - 1)}-01`;
};

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
  const setupArbitrary = todayArbitrary.chain((today) =>
    fc.record({
      today: fc.constant(today),
      // A closed period is a past month at most up to the current one.
      latestClosedPeriodEnd: fc.option(berlinDateArbitrary.filter((date) => date <= today).map(monthEndOf), {
        nil: null,
      }),
      earliestActivityDate: fc.option(berlinDateArbitrary, { nil: null }),
    }),
  );

  test('is the first day of a month after every closed period', () => {
    fc.assert(
      fc.property(setupArbitrary, (setup) => {
        const start = suggestTimeAccountStartDate(setup);
        expect(start).toBe(monthStartOf(start));
        if (setup.latestClosedPeriodEnd) expect(start > setup.latestClosedPeriodEnd).toBe(true);
      }),
    );
  });

  test('leaves no month without a close before it that has recorded time or is the current month', () => {
    fc.assert(
      fc.property(setupArbitrary, (setup) => {
        const start = suggestTimeAccountStartDate(setup);
        const monthBeforeIsOpen =
          setup.latestClosedPeriodEnd === null || monthBefore(start) > setup.latestClosedPeriodEnd;
        // Unless the month before the proposal is closed, nothing before it needs an account:
        // neither recorded time nor the current month.
        if (monthBeforeIsOpen) {
          expect(start <= monthStartOf(setup.today)).toBe(true);
          if (setup.earliestActivityDate === null) expect(start).toBe(monthStartOf(setup.today));
          else
            expect(
              start <= monthStartOf(setup.earliestActivityDate) || start === monthStartOf(setup.today),
            ).toBe(true);
        }
      }),
    );
  });
});
