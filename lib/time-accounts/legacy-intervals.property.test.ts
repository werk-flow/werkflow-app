import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinDateArbitrary, berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import { legacyEntriesAround } from '@/lib/testing/time-account-arbitraries';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { buildLegacyIntervals } from './legacy-intervals';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md:
// time recorded before the segment model stays unchanged and counts as it was confirmed
// ("Recovery"), and only accepted results count, never a pending proposal ("Correction
// lifecycle"). Each start ends at the next clock-out or break, and a start without an end stays
// uncounted ("Activities"). The period calculation reads these intervals as recorded time.

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const entriesArbitrary = berlinDateArbitrary.chain((date) => legacyEntriesAround(berlinMidnightMs(date)));

/** The approved entries in time order; the arbitrary draws distinct timestamps. */
const approvedInOrder = (entries: readonly TimeEntry[]): TimeEntry[] =>
  entries
    .filter((entry) => entry.status === 'approved')
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

/** A rebuilt block: a break, or recorded work of a kind on a job or unallocated. */
type Block = { startedAt: string; endedAt: string; kind: 'break' | 'work' | 'callout'; jobId: string | null };

/**
 * Well-formed days of clock entries: one shift per Berlin day from the drawn date, each a clock-in,
 * work blocks with a break between two of them, and a clock-out, at whole minutes and inside its
 * day. The last shift may still lack its clock-out. Entries that are not approved fall between
 * them at half minutes, so no two entries share a time.
 */
const shiftDaysArbitrary = berlinDateArbitrary.chain((firstDay) =>
  fc
    .record({
      shifts: fc.array(
        fc.record({
          startMinute: fc.integer({ min: 0, max: 120 }),
          work: fc.array(fc.integer({ min: 1, max: 200 }), { minLength: 1, maxLength: 4 }),
          breaks: fc.array(fc.integer({ min: 1, max: 60 }), { minLength: 3, maxLength: 3 }),
          jobId: fc.option(fc.constantFrom('job-1', 'job-2'), { nil: null }),
          kind: fc.constantFrom('work' as const, 'callout' as const),
        }),
        { maxLength: 4 },
      ),
      openEnd: fc.boolean(),
      noise: fc.array(
        fc.record({
          day: fc.nat({ max: 3 }),
          minute: fc.nat({ max: 1_200 }),
          entryType: fc.constantFrom('clock_in' as const, 'clock_out' as const, 'break_start' as const),
          status: fc.constantFrom('pending' as const, 'rejected' as const, 'pending_delete' as const),
        }),
        { maxLength: 4 },
      ),
    })
    .map(({ shifts, openEnd, noise }) => {
      const midnight = (day: number): number =>
        berlinMidnightMs(
          new Date(Date.parse(`${firstDay}T00:00:00Z`) + day * DAY_MS).toISOString().slice(0, 10),
        );
      const entries: TimeEntry[] = [];
      const add = (
        instant: number,
        entryType: TimeEntry['entryType'],
        status: TimeEntry['status'],
        jobId: string | null,
        activityKind?: 'work' | 'callout',
      ): string => {
        const timestamp = new Date(instant).toISOString();
        entries.push({
          id: `entry-${entries.length}`,
          userId: 'user-1',
          organizationId: 'org-1',
          entryType,
          timestamp,
          isManual: false,
          jobId,
          status,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(activityKind ? { activityKind } : {}),
        });
        return timestamp;
      };
      const blocks: Block[] = [];
      shifts.forEach((shift, index) => {
        let cursor = midnight(index) + shift.startMinute * MINUTE_MS;
        let startedAt = add(cursor, 'clock_in', 'approved', shift.jobId, shift.kind);
        const open = openEnd && index === shifts.length - 1;
        shift.work.forEach((minutes, block) => {
          cursor += minutes * MINUTE_MS;
          if (block === shift.work.length - 1) {
            if (!open)
              blocks.push({
                startedAt,
                endedAt: add(cursor, 'clock_out', 'approved', null),
                kind: shift.kind,
                jobId: shift.jobId,
              });
            return;
          }
          const breakStart = add(cursor, 'break_start', 'approved', null);
          blocks.push({ startedAt, endedAt: breakStart, kind: shift.kind, jobId: shift.jobId });
          cursor += (shift.breaks[block] ?? 1) * MINUTE_MS;
          startedAt = add(cursor, 'break_end', 'approved', shift.jobId, shift.kind);
          blocks.push({ startedAt: breakStart, endedAt: startedAt, kind: 'break', jobId: null });
        });
      });
      for (const extra of noise)
        add(midnight(extra.day) + extra.minute * MINUTE_MS + 30_000, extra.entryType, extra.status, null);
      return { entries, blocks };
    }),
);

describe('Intervals rebuilt from clock entries', () => {
  test('run from each start to its clock-out or break, and leave a start without an end uncounted', () => {
    fc.assert(
      fc.property(shiftDaysArbitrary, ({ entries, blocks }) => {
        expect(
          buildLegacyIntervals(entries, 'record-1').map((interval) => ({
            startedAt: interval.startedAt,
            endedAt: interval.endedAt,
            activityKind: interval.activityKind,
            allocationKind: interval.activityKind === 'break' ? 'unallocated' : interval.allocationKind,
            jobId: interval.jobId ?? null,
          })),
        ).toEqual(
          // Each recorded activity keeps its kind and its job, unallocated without one.
          blocks.map(({ startedAt, endedAt, kind, jobId }) => ({
            startedAt,
            endedAt,
            activityKind: kind,
            allocationKind: kind !== 'break' && jobId ? 'job' : 'unallocated',
            jobId,
          })),
        );
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
