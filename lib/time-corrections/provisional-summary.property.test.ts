import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import { berlinDateArbitrary, berlinMidnightMs } from '@/lib/testing/berlin-arbitraries';
import {
  DAY_MINUTES,
  MINUTE_MS,
  correctionStartArbitrary,
  openTimeArbitrary,
  openTimeFacts,
  oracleBerlinDate,
  type OpenTime,
} from '@/lib/testing/time-correction-arbitraries';
import { summarizePendingCorrections, type PendingSubmissionFact } from './provisional-summary';
import type { TimeCorrectionRequest, TimeCorrectionSnapshot } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Correction lifecycle": the overview's „Vorgemerkte Zeit“ sums the pending corrections and manual
// submissions and names the days they change, and a legacy time longer than a week by its first and
// last day.

type Revision = TimeCorrectionRequest['revision'];

/** One side of a correction: the subject's open time or none (a deletion), and maybe another person's. */
const sideArbitrary = fc.record({
  subject: fc.option(openTimeArbitrary(DAY_MINUTES), { nil: null }),
  other: fc.option(openTimeArbitrary(DAY_MINUTES), { nil: null }),
});
type Side = { subject: OpenTime | null; other: OpenTime | null };

const snapshotOf = (side: Side, prefix: string): TimeCorrectionSnapshot => ({
  schemaVersion: 1,
  facts: [
    ...(side.subject ? openTimeFacts(side.subject, `${prefix}-subject`) : []),
    // A reassignment keeps the other person's time in the same snapshot.
    ...(side.other
      ? openTimeFacts(side.other, `${prefix}-other`, { userId: 'other', employeeRecordId: 'other-record' })
      : []),
  ],
});

const requestArbitrary = fc.record({ before: sideArbitrary, proposed: sideArbitrary });
type Drawn = { before: Side; proposed: Side };

function pendingRequest(drawn: Drawn, index: number): Pick<TimeCorrectionRequest, 'revision'> {
  const revision: Revision = {
    revision: 1,
    reason: 'Vergessen',
    beforeSnapshot: snapshotOf(drawn.before, `request-${index}-before`),
    proposedSnapshot: snapshotOf(drawn.proposed, `request-${index}-proposed`),
    createdBy: 'person',
    createdAt: '2026-11-22T10:00:00Z',
  };
  return { revision };
}

/** The Berlin days open time touches, from its start's day to its last minute's. */
function daysOf(time: Pick<OpenTime, 'start' | 'end'>): string[] {
  const last = oracleBerlinDate(time.end - 1);
  const days: string[] = [];
  for (let day = oracleBerlinDate(time.start); day <= last; ) {
    days.push(day);
    day = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MINUTES * MINUTE_MS).toISOString().slice(0, 10);
  }
  return days;
}

/** Unsplit legacy time without a break from `start` to `end`. */
function legacyTime(start: string, end: string): OpenTime {
  const [from, to] = [Date.parse(start), Date.parse(end)];
  return { start: from, end: to, break: null, workMinutes: (to - from) / MINUTE_MS, breakMinutes: 0 };
}

/**
 * Unsplit legacy time without a break, touching 1 to 15 Berlin days, often six to nine: from a
 * minute of its first day to a minute of its last, or to the midnight that ends it.
 */
const legacyTimeArbitrary = fc
  .tuple(
    berlinDateArbitrary,
    fc.oneof(fc.integer({ min: 5, max: 8 }), fc.integer({ min: 0, max: 14 })),
    fc.integer({ min: 0, max: 23 * 60 - 1 }),
    fc.integer({ min: 1, max: DAY_MINUTES }),
  )
  .map(([firstDay, extraDays, startMinute, endMinute]) => {
    const dayAfter = (days: number): string =>
      new Date(Date.parse(`${firstDay}T00:00:00Z`) + days * DAY_MINUTES * MINUTE_MS)
        .toISOString()
        .slice(0, 10);
    const start = berlinMidnightMs(firstDay) + startMinute * MINUTE_MS;
    const end = Math.min(
      berlinMidnightMs(dayAfter(extraDays)) + endMinute * MINUTE_MS,
      berlinMidnightMs(dayAfter(extraDays + 1)),
    );
    return end > start
      ? { start, end, break: null, workMinutes: (end - start) / MINUTE_MS, breakMinutes: 0 }
      : null;
  })
  .filter((time) => time !== null);

const subjectTimes = (drawn: readonly Drawn[], side: 'before' | 'proposed'): OpenTime[] =>
  drawn.flatMap((request) => (request[side].subject ? [request[side].subject] : []));
const sumOf = (times: readonly OpenTime[]): number => times.reduce((sum, time) => sum + time.workMinutes, 0);
const sortedDays = (times: readonly Pick<OpenTime, 'start' | 'end'>[]): string[] =>
  [...new Set(times.flatMap(daysOf))].sort();

describe('„Vorgemerkte Zeit“', () => {
  test('sums the subject’s time before and after each pending correction and names its days', () => {
    fc.assert(
      fc.property(fc.array(requestArbitrary, { maxLength: 4 }), (drawn) => {
        const summary = summarizePendingCorrections(drawn.map(pendingRequest), 'person');
        expect(summary.count).toBe(drawn.length);
        expect(summary.beforeMinutes).toBe(sumOf(subjectTimes(drawn, 'before')));
        expect(summary.proposedMinutes).toBe(sumOf(subjectTimes(drawn, 'proposed')));
        expect(summary.days).toEqual(
          sortedDays([...subjectTimes(drawn, 'before'), ...subjectTimes(drawn, 'proposed')]),
        );
      }),
    );
  });

  test('names the days of legacy time of up to a week one by one, and of a longer one its first and last day', () => {
    fc.assert(
      fc.property(
        legacyTimeArbitrary,
        fc.option(openTimeArbitrary(DAY_MINUTES), { nil: null }),
        (legacy, proposed) => {
          const drawn: Drawn = {
            before: { subject: legacy, other: null },
            proposed: { subject: proposed, other: null },
          };
          const summary = summarizePendingCorrections([pendingRequest(drawn, 0)], 'person');
          const legacyDays = daysOf(legacy);
          const proposedDays = proposed ? daysOf(proposed) : [];
          const first = legacyDays[0];
          const last = legacyDays.at(-1);
          if (!first || !last) throw new Error('Legacy time touches at least one day.');
          const expected =
            legacyDays.length <= 7
              ? [...new Set([...legacyDays, ...proposedDays])].sort()
              : [...proposedDays.filter((day) => day < first || day > last), { first, last }].sort(
                  (left, right) =>
                    (typeof left === 'string' ? left : left.first).localeCompare(
                      typeof right === 'string' ? right : right.first,
                    ),
                );
          expect(summary.days).toEqual(expected);
          expect(summary.beforeMinutes).toBe(legacy.workMinutes);
        },
      ),
      {
        examples: [
          // Monday 08:00 to Sunday 17:00 Berlin touches seven days, to the next Monday 07:00 eight.
          [legacyTime('2026-11-09T07:00:00Z', '2026-11-15T16:00:00Z'), null],
          [legacyTime('2026-11-09T07:00:00Z', '2026-11-16T06:00:00Z'), null],
        ],
      },
    );
  });

  test('adds each pending manual submission to the accepted time of its days', () => {
    fc.assert(
      fc.property(
        correctionStartArbitrary,
        fc.array(
          fc.record({
            gap: fc.integer({ min: 1, max: 600 }),
            minutes: fc.integer({ min: 1, max: 600 }),
            submission: fc.integer({ min: -1, max: 2 }),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (first, draws) => {
          let cursor = first;
          const times = draws.map((draw) => {
            const start = cursor + draw.gap * MINUTE_MS;
            cursor = start + draw.minutes * MINUTE_MS;
            return { start, end: cursor, minutes: draw.minutes, submission: draw.submission };
          });
          const factsOf = (time: { start: number; end: number }): PendingSubmissionFact[] => [
            { entryType: 'clock_in', timestamp: new Date(time.start).toISOString() },
            { entryType: 'clock_out', timestamp: new Date(time.end).toISOString() },
          ];
          const accepted = times.filter((time) => time.submission < 0);
          const submitted = times.filter((time) => time.submission >= 0);
          const pending = [0, 1, 2]
            .map((index) => submitted.filter((time) => time.submission === index).flatMap(factsOf))
            .filter((facts) => facts.length > 0);
          const summary = summarizePendingCorrections([], 'person', {
            pending,
            acceptedOnTheirDays: accepted.flatMap(factsOf),
          });
          const minutes = (list: readonly { minutes: number }[]) =>
            list.reduce((sum, time) => sum + time.minutes, 0);
          expect(summary.submissionCount).toBe(pending.length);
          expect(summary.beforeMinutes).toBe(minutes(accepted));
          expect(summary.proposedMinutes).toBe(minutes(accepted) + minutes(submitted));
          expect(summary.days).toEqual(sortedDays(submitted));
        },
      ),
    );
  });
});
