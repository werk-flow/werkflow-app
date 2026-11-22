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
  type ClosedTimePeriod,
  closedPeriodsToHide,
  entryBusinessDate,
  isDateInClosedPeriod,
  isEntryInClosedPeriod,
} from './closed-period-dates';
import { TIME_ENTRY_TYPES } from './types';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Period close" and "Closed periods": a period is a Berlin
// calendar month; any write of recorded time whose day lies in a closed period fails. A closing
// entry at exactly midnight closes the day before, as the database's guard counts it.

const MINUTE_MS = 60_000;

/** The Berlin date of an instant by the EU rule, without the module. */
const oracleDate = (instant: number): string =>
  new Date(instant + berlinOffsetMinutes(instant) * MINUTE_MS).toISOString().slice(0, 10);

/** Recorded minutes, Berlin midnights drawn often. */
const recordedInstantArbitrary = fc.oneof(
  berlinMinuteInstantMsArbitrary,
  berlinDateArbitrary.map(berlinMidnightMs),
);

/** The closed month that holds a date: its first and last Berlin date. */
function monthOf(date: string): ClosedTimePeriod {
  const nextMonth = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1));
  return {
    startDate: `${date.slice(0, 7)}-01`,
    endDate: addLocalDays(nextMonth.toISOString().slice(0, 10), -1),
  };
}

const closedMonthArbitrary: fc.Arbitrary<ClosedTimePeriod> = berlinDateArbitrary.map(monthOf);

describe('A closed period', () => {
  test('holds every day from its first to its last date and neither neighbour', () => {
    fc.assert(
      fc.property(closedMonthArbitrary, fc.integer({ min: 0, max: 30 }), (period, offset) => {
        const day = addLocalDays(period.startDate, offset);
        expect(isDateInClosedPeriod(day, [period])).toBe(day <= period.endDate);
        expect(isDateInClosedPeriod(addLocalDays(period.startDate, -1), [period])).toBe(false);
        expect(isDateInClosedPeriod(addLocalDays(period.endDate, 1), [period])).toBe(false);
      }),
    );
  });

  test('closes a date that one of several months holds, wherever it stands, and no date outside them', () => {
    fc.assert(
      fc.property(
        berlinDateArbitrary,
        fc.array(closedMonthArbitrary, { maxLength: 5 }),
        fc.boolean(),
        fc.nat(),
        (date, drawn, holds, position) => {
          const others = drawn.filter((period) => period.startDate.slice(0, 7) !== date.slice(0, 7));
          const own = monthOf(date);
          const periods = holds
            ? [
                ...others.slice(0, position % (others.length + 1)),
                own,
                ...others.slice(position % (others.length + 1)),
              ]
            : others;
          expect(isDateInClosedPeriod(date, periods)).toBe(holds);
        },
      ),
    );
  });

  test('hides no edit while the list of closed periods is unknown or stale', () => {
    fc.assert(
      fc.property(fc.array(closedMonthArbitrary, { maxLength: 4 }), fc.boolean(), (periods, stale) => {
        expect(closedPeriodsToHide(undefined, stale)).toEqual([]);
        expect(closedPeriodsToHide(periods, true)).toEqual([]);
        expect(closedPeriodsToHide(periods, false)).toBe(periods);
      }),
    );
  });
});

describe('A recorded entry’s day', () => {
  test('is its Berlin date, except an end at midnight, which closes the day before', () => {
    fc.assert(
      fc.property(recordedInstantArbitrary, fc.constantFrom(...TIME_ENTRY_TYPES), (instant, entryType) => {
        const date = oracleDate(instant);
        const atMidnight = berlinMidnightMs(date) === instant;
        const ends = entryType === 'clock_out' || entryType === 'break_end';
        const timestamp = new Date(instant).toISOString();
        expect(entryBusinessDate({ timestamp, entryType })).toBe(
          atMidnight && ends ? addLocalDays(date, -1) : date,
        );
      }),
      {
        examples: [
          [Date.parse('2026-12-31T23:00:00Z'), 'clock_out'],
          [Date.parse('2026-12-31T23:00:00Z'), 'clock_in'],
          [Date.parse('2026-12-31T23:00:00Z'), 'break_end'],
        ],
      },
    );
  });

  test('of an end at midnight on the first of a month is closed with the month before, not with the new one', () => {
    fc.assert(
      fc.property(berlinDateArbitrary, fc.constantFrom('clock_out', 'break_end'), (date, entryType) => {
        const first = `${date.slice(0, 7)}-01`;
        const entry = { timestamp: new Date(berlinMidnightMs(first)).toISOString(), entryType };
        const lastOfBefore = addLocalDays(first, -1);
        expect(isEntryInClosedPeriod(entry, [monthOf(lastOfBefore)])).toBe(true);
        expect(isEntryInClosedPeriod(entry, [monthOf(first)])).toBe(false);
        const start = { timestamp: entry.timestamp, entryType: 'clock_in' as const };
        expect(isEntryInClosedPeriod(start, [monthOf(first)])).toBe(true);
        expect(isEntryInClosedPeriod(start, [monthOf(lastOfBefore)])).toBe(false);
      }),
    );
  });
});
