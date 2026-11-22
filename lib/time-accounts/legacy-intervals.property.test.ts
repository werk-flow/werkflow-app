import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinDateArbitrary, berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { legacyEntriesAround } from '@/lib/testing/time-account-arbitraries';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { buildLegacyIntervals } from './legacy-intervals';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md:
// time recorded before the segment model stays unchanged and counts as it was confirmed
// ("Recovery"), and only accepted results count, never a pending proposal ("Correction
// lifecycle"). The period calculation reads these intervals as recorded time.

const entriesArbitrary = berlinDateArbitrary.chain((date) => legacyEntriesAround(berlinMidnightMs(date)));

/** The approved entries in time order; the arbitrary draws distinct timestamps. */
const approvedInOrder = (entries: readonly TimeEntry[]): TimeEntry[] =>
  entries
    .filter((entry) => entry.status === 'approved')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

describe('Intervals rebuilt from clock entries', () => {
  test('run from each approved start to the next approved entry, and only there', () => {
    fc.assert(
      fc.property(entriesArbitrary, (entries) => {
        const approved = approvedInOrder(entries);
        const expected = approved.flatMap((entry, index) => {
          const next = approved[index + 1];
          return entry.entryType === 'clock_out' || !next
            ? []
            : [
                {
                  startedAt: entry.timestamp,
                  endedAt: next.timestamp,
                  isBreak: entry.entryType === 'break_start',
                },
              ];
        });
        expect(
          buildLegacyIntervals(entries, 'record-1').map((interval) => ({
            startedAt: interval.startedAt,
            endedAt: interval.endedAt,
            isBreak: interval.activityKind === 'break',
          })),
        ).toEqual(expected);
      }),
    );
  });

  test('are unchanged by entries that are pending, rejected or awaiting deletion', () => {
    fc.assert(
      fc.property(entriesArbitrary, (entries) => {
        expect(buildLegacyIntervals(entries, 'record-1')).toEqual(
          buildLegacyIntervals(approvedInOrder(entries), 'record-1'),
        );
      }),
    );
  });

  test('do not depend on the order the entries are read in', () => {
    fc.assert(
      fc.property(
        entriesArbitrary.chain((entries) =>
          fc.tuple(fc.constant(entries), fc.shuffledSubarray(entries, { minLength: entries.length })),
        ),
        ([entries, shuffled]) => {
          expect(buildLegacyIntervals(shuffled, 'record-1')).toEqual(
            buildLegacyIntervals(entries, 'record-1'),
          );
        },
      ),
    );
  });
});
