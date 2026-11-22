import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { RECORDED_DAY_CLOCK, recordedDayArbitrary } from '@/lib/testing/time-entry-arbitraries';
import type { TimeEntry, TimeEntryType } from './types';
import type { TimeValidationCode } from './validation-messages';
import { validateDayEntrySequence, validateManualEntries } from './validation';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Manual entries" and "Added time as a timeline": every entry
// passes sequence and overlap checks; a break lies between two stretches of work; rejected entries
// and pending deletions never count.

beforeAll(() => setSystemTime(RECORDED_DAY_CLOCK));
afterAll(() => setSystemTime());

const MINUTE_MS = 60_000;

function extra(
  base: TimeEntry,
  entryType: TimeEntryType,
  instant: number,
  status: TimeEntry['status'] = 'approved',
): TimeEntry {
  const timestamp = new Date(instant).toISOString();
  return {
    ...base,
    id: `extra-${timestamp}`,
    entryType,
    timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    status,
  };
}

/** The refusal of an event repeated right after itself. */
const REPEATED: Record<TimeEntryType, TimeValidationCode> = {
  clock_in: 'sequence_clock_in_while_open',
  break_end: 'sequence_break_end_not_on_break',
  break_start: 'sequence_break_start_not_working',
  clock_out: 'sequence_clock_out_while_clocked_out',
};

/** A recorded day, one of its entries and a later moment before the next entry. */
const dayWithPlaceArbitrary = recordedDayArbitrary.chain((day) =>
  fc.tuple(
    fc.constant(day),
    fc.integer({ min: 0, max: day.entries.length - 1 }),
    fc.double({ min: 0, max: 1, noNaN: true, maxExcluded: true }),
  ),
);

describe('A day’s entry sequence', () => {
  test('is valid when every start is closed in order, in any input order', () => {
    fc.assert(
      fc.property(
        recordedDayArbitrary.chain((day) =>
          fc.shuffledSubarray(day.entries, { minLength: day.entries.length }),
        ),
        (entries) => {
          expect(validateDayEntrySequence(entries)).toEqual({ valid: true });
        },
      ),
    );
  });

  test('ignores any rejected entry or pending deletion', () => {
    fc.assert(
      fc.property(
        dayWithPlaceArbitrary,
        fc.constantFrom<TimeEntryType>('clock_in', 'clock_out', 'break_start', 'break_end'),
        fc.constantFrom<TimeEntry['status']>('rejected', 'pending_delete'),
        ([day, index, share], entryType, status) => {
          const base = day.entries[index];
          if (!base) throw new Error('index within the day');
          const next = day.entries[index + 1];
          const from = Date.parse(base.timestamp);
          const instant =
            from + Math.floor(((next ? Date.parse(next.timestamp) : from + MINUTE_MS) - from) * share);
          expect(validateDayEntrySequence([...day.entries, extra(base, entryType, instant, status)])).toEqual(
            {
              valid: true,
            },
          );
        },
      ),
    );
  });

  test('refuses a second start inside running work, a break inside a break and an end that closes nothing', () => {
    fc.assert(
      fc.property(dayWithPlaceArbitrary, ([day, index, share]) => {
        const base = day.entries[index];
        const next = day.entries[index + 1];
        if (!base) throw new Error('index within the day');
        const from = Date.parse(base.timestamp);
        const to = next ? Date.parse(next.timestamp) : from + MINUTE_MS;
        const instant = from + Math.floor((to - from) * share);
        // The same event again: a clock-in after a clock-in, a break end after a break end. A clock-in
        // right after a break end is the legacy way to resume (transition-pairs.ts), so it is no case.
        const result = validateDayEntrySequence([...day.entries, extra(base, base.entryType, instant)]);
        expect(result.valid).toBe(false);
        if (!result.valid) expect(result.failure.error).toBe(REPEATED[base.entryType]);
      }),
    );
  });
});

describe('A manual pair of clock-in and clock-out', () => {
  test('is refused inside recorded work and taken in a free gap of the same day', () => {
    fc.assert(
      fc.property(dayWithPlaceArbitrary, ([day, index]) => {
        const base = day.entries[index];
        const next = day.entries[index + 1];
        if (!base) throw new Error('index within the day');
        const from = Date.parse(base.timestamp);
        const to = next ? Date.parse(next.timestamp) : from + 3 * MINUTE_MS;
        fc.pre(to - from >= 3 * MINUTE_MS && base.entryType !== 'break_start');
        const pair = [
          { entryType: 'clock_in' as const, timestamp: new Date(from + MINUTE_MS).toISOString() },
          { entryType: 'clock_out' as const, timestamp: new Date(to - MINUTE_MS).toISOString() },
        ];
        const working = base.entryType === 'clock_in' || base.entryType === 'break_end';
        expect(validateManualEntries(day.entries, pair).valid).toBe(!working);
      }),
    );
  });

  test('is refused in the future and across Berlin days', () => {
    fc.assert(
      fc.property(recordedDayArbitrary, fc.integer({ min: 1, max: 600 }), (day, minutes) => {
        const later = RECORDED_DAY_CLOCK.getTime() + minutes * MINUTE_MS;
        const future = [
          { entryType: 'clock_in' as const, timestamp: new Date(later).toISOString() },
          { entryType: 'clock_out' as const, timestamp: new Date(later + MINUTE_MS).toISOString() },
        ];
        expect(validateManualEntries(day.entries, future)).toEqual({
          valid: false,
          failure: { error: 'manual_entry_in_future' },
        });
        const [first] = day.entries;
        if (!first) throw new Error('a recorded day has entries');
        const start = Date.parse(first.timestamp);
        const overnight = [
          { entryType: 'clock_in' as const, timestamp: new Date(start).toISOString() },
          { entryType: 'clock_out' as const, timestamp: new Date(start + 26 * 60 * MINUTE_MS).toISOString() },
        ];
        expect(validateManualEntries(day.entries, overnight)).toEqual({
          valid: false,
          failure: { error: 'manual_entries_span_days' },
        });
      }),
    );
  });
});
