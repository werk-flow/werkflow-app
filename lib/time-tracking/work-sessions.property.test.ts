import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import fc from 'fast-check';
import { RECORDED_DAY_CLOCK, recordedDayArbitrary } from '@/lib/testing/time-entry-arbitraries';
import type { TimeEntry } from './types';
import { calculateBreakSessions, calculateWorkSessions } from './work-sessions';

// Property tests (docs/technical/testing.md, "Property tests"). The rules come from
// docs/features/time-tracking.md, "Activities" and "Targets": recorded work runs from a start to
// the next clock-out or break of that day, breaks are not work, an earlier start without an end
// stays uncounted, and rejected entries or pending deletions never count.

beforeAll(() => setSystemTime(RECORDED_DAY_CLOCK));
afterAll(() => setSystemTime());

const sum = (values: ReadonlyArray<number | null>): number =>
  values.reduce<number>((total, value) => total + (value ?? 0), 0);

const shuffledDay = recordedDayArbitrary.chain((day) =>
  fc.tuple(fc.constant(day), fc.shuffledSubarray(day.entries, { minLength: day.entries.length })),
);

describe('A recorded day’s sessions', () => {
  test('count every work run and every break exactly once, in any input order', () => {
    fc.assert(
      fc.property(shuffledDay, ([day, shuffled]) => {
        const work = calculateWorkSessions(shuffled);
        const breaks = calculateBreakSessions(shuffled);
        expect(work.map((session) => session.durationMinutes)).toEqual(day.runs);
        expect(work.some((session) => session.isOrphan)).toBe(false);
        expect(sum(breaks.map((session) => session.durationMinutes))).toBe(day.breakMinutes);
        expect(breaks).toHaveLength(day.breaks);
      }),
    );
  });

  test('stay the same when an entry is added and then rejected or withdrawn', () => {
    fc.assert(
      fc.property(
        recordedDayArbitrary,
        fc.nat(),
        fc.constantFrom('rejected', 'pending_delete'),
        fc.constantFrom('clock_in', 'clock_out', 'break_start', 'break_end'),
        (day, at, status, entryType) => {
          const [first] = day.entries;
          if (!first) throw new Error('a recorded day has entries');
          const last = day.entries.at(-1) ?? first;
          const start = Date.parse(first.timestamp);
          const instant = start + (at % (Date.parse(last.timestamp) - start + 1));
          const cancelled: TimeEntry = {
            ...first,
            id: '00000000-0000-4000-8000-ffffffffffff',
            entryType,
            timestamp: new Date(instant).toISOString(),
            status,
          };
          const withCancelled = [...day.entries, cancelled];
          expect(calculateWorkSessions(withCancelled)).toEqual(calculateWorkSessions(day.entries));
          expect(calculateBreakSessions(withCancelled)).toEqual(calculateBreakSessions(day.entries));
        },
      ),
    );
  });

  test('leave an earlier day’s start without its clock-out uncounted, as „Ende fehlt“', () => {
    fc.assert(
      fc.property(recordedDayArbitrary, (day) => {
        const withoutEnd = day.entries.slice(0, -1);
        const work = calculateWorkSessions(withoutEnd);
        const unclosed = work.at(-1);
        expect(unclosed?.durationMinutes).toBeNull();
        expect(unclosed?.isOrphan).toBe(true);
        expect(sum(work.map((session) => session.durationMinutes))).toBe(
          day.workMinutes - (day.runs.at(-1) ?? 0),
        );
      }),
    );
  });
});
