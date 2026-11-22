import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
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
// submissions and names the days they change. A withdrawn proposal leaves the sum of the others.

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

  test('of all pending corrections is the sum of its parts, so a withdrawal leaves the others', () => {
    fc.assert(
      fc.property(
        fc.array(requestArbitrary, { maxLength: 3 }),
        fc.array(requestArbitrary, { minLength: 1, maxLength: 2 }),
        (kept, withdrawn) => {
          const summarize = (drawn: readonly Drawn[]) =>
            summarizePendingCorrections(drawn.map(pendingRequest), 'person');
          const all = summarize([...kept, ...withdrawn]);
          const rest = summarize(kept);
          const gone = summarize(withdrawn);
          expect(all.beforeMinutes).toBe(rest.beforeMinutes + gone.beforeMinutes);
          expect(all.proposedMinutes).toBe(rest.proposedMinutes + gone.proposedMinutes);
          expect(all.days).toEqual([...new Set([...rest.days, ...gone.days])].sort());
        },
      ),
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
