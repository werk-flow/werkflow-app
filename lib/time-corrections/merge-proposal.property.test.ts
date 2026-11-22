import { describe, expect, test } from 'bun:test';
import fc from 'fast-check';
import {
  DAY_MINUTES,
  MINUTE_MS,
  clockMinutes,
  correctionFact,
  openTimeArbitrary,
  openTimeFacts,
  type OpenTime,
} from '@/lib/testing/time-correction-arbitraries';
import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { TimeActivitySelection, TimeSegmentKind } from '@/lib/time-tracking/types';
import { mergeCorrectionProposal } from './merge-proposal';
import { splitCorrectionFactsAtMidnight } from './timeline-validation';
import type { TimeCorrectionFact, TimeCorrectionSnapshot } from './types';

// Property tests (docs/technical/testing.md, "Property tests") of docs/features/time-tracking.md,
// "Corrections": a guided `Zeitkorrektur` covers edit, activity reclassification, job reallocation
// and employee reassignment. Each kind changes only what it names: an edit the times, a
// reclassification the activity, a reallocation the job, a reassignment the person; the recorded
// minutes of the other kinds stay as they are.

const ACTIVITIES: TimeActivitySelection[] = [
  createActivitySelection('work', 'job-a'),
  createActivitySelection('work'),
  createActivitySelection('callout', 'job-b'),
  createActivitySelection('travel', 'job-a'),
  createActivitySelection('standby'),
  createActivitySelection('internal_activity'),
];

/** The fields of a fact that name its activity, job and person. */
const contextOf = (activity: TimeActivitySelection, userId = 'person'): Partial<TimeCorrectionFact> => ({
  activity,
  activityKind: activity.kind,
  jobId: 'jobId' in activity ? (activity.jobId ?? null) : null,
  userId,
  employeeRecordId: `${userId}-record`,
});

/** Recorded open time with one activity, as stored or as split at Berlin midnight. */
const sourceArbitrary = fc
  .tuple(openTimeArbitrary(DAY_MINUTES), fc.constantFrom(...ACTIVITIES), fc.boolean())
  .map(([time, activity, split]) => {
    const facts = openTimeFacts(time, 'source', contextOf(activity));
    return {
      time,
      activity,
      before: { schemaVersion: 1 as const, facts: split ? splitCorrectionFactsAtMidnight(facts) : facts },
    };
  });

const snapshot = (facts: TimeCorrectionFact[]): TimeCorrectionSnapshot => ({ schemaVersion: 1, facts });
const timeOf = (facts: readonly TimeCorrectionFact[]) =>
  facts.map(({ factId, entryType, timestamp }) => ({ factId, entryType, timestamp }));

describe('A correction of recorded time', () => {
  test('that reassigns changes only the person', () => {
    fc.assert(
      fc.property(sourceArbitrary, ({ before }) => {
        const patch = correctionFact(
          'patch',
          'clock_in',
          0,
          contextOf(createActivitySelection('callout'), 'new'),
        );
        expect(mergeCorrectionProposal('reassign', before, snapshot([patch]))).toEqual(
          snapshot(before.facts.map((fact) => ({ ...fact, userId: 'new', employeeRecordId: 'new-record' }))),
        );
      }),
    );
  });

  test('that reallocates changes only the job of work, call-out and travel', () => {
    fc.assert(
      fc.property(sourceArbitrary, fc.constantFrom('job-new', null), ({ before }, jobId) => {
        const patch = correctionFact('patch', 'clock_in', 0, { jobId });
        const merged = mergeCorrectionProposal('reallocate', before, snapshot([patch]));
        expect(timeOf(merged?.facts ?? [])).toEqual(timeOf(before.facts));
        for (const [index, fact] of (merged?.facts ?? []).entries()) {
          const recorded = before.facts[index];
          if (!recorded) throw new Error('A reallocation keeps every recorded fact.');
          expect(fact).toMatchObject({ userId: recorded.userId, activityKind: recorded.activityKind });
          const allocated = ['work', 'callout', 'travel'].includes(fact.activityKind ?? '');
          expect(fact.jobId).toBe(allocated ? jobId : recorded.jobId);
        }
      }),
    );
  });

  test('that reclassifies changes only the activity, or is refused for an activity that needs details', () => {
    fc.assert(
      fc.property(
        sourceArbitrary.filter(({ time }) => time.break === null),
        fc.constantFrom<TimeSegmentKind>(
          'work',
          'callout',
          'break',
          'travel',
          'standby',
          'internal_activity',
        ),
        ({ before, activity }, kind) => {
          const patch = correctionFact('patch', 'clock_in', 0, { activityKind: kind });
          const merged = mergeCorrectionProposal('reclassify', before, snapshot([patch]));
          if (!merged) {
            expect(['travel', 'standby', 'internal_activity']).toContain(kind);
            expect(kind).not.toBe(activity.kind);
            return;
          }
          expect(timeOf(merged.facts)).toEqual(timeOf(before.facts));
          expect(merged.facts.map((fact) => [fact.userId, fact.activityKind])).toEqual(
            before.facts.map((fact) => [fact.userId, kind]),
          );
        },
      ),
    );
  });
});

/** The minutes an edit leaves: from the kept start to the new end, or from the new start to the kept end. */
const editedMinutes = (from: number, to: number, time: OpenTime): number =>
  (to - from) / MINUTE_MS - time.breakMinutes;

describe('An edit of recorded time', () => {
  test('with a new start and end takes those times and keeps the activity, job and person', () => {
    fc.assert(
      fc.property(
        sourceArbitrary.filter(({ time }) => time.break === null),
        openTimeArbitrary(DAY_MINUTES),
        fc.constantFrom(...ACTIVITIES),
        ({ before, activity }, edit, proposedActivity) => {
          const proposal = snapshot([
            correctionFact('start', 'clock_in', edit.start, contextOf(proposedActivity)),
            correctionFact('end', 'clock_out', edit.end, contextOf(proposedActivity)),
          ]);
          const merged = mergeCorrectionProposal('edit', before, proposal);
          expect(merged?.facts.map((fact) => [fact.entryType, fact.timestamp])).toEqual([
            ['clock_in', new Date(edit.start).toISOString()],
            ['clock_out', new Date(edit.end).toISOString()],
          ]);
          for (const fact of merged?.facts ?? []) expect(fact).toMatchObject(contextOf(activity));
        },
      ),
    );
  });

  test('of only the end or only the start moves that boundary and keeps the rest of the time', () => {
    fc.assert(
      fc.property(
        sourceArbitrary,
        fc.boolean(),
        fc.integer({ min: 1, max: DAY_MINUTES }),
        fc.constantFrom(...ACTIVITIES),
        ({ before, time, activity }, movesEnd, minutes, proposedActivity) => {
          // The new boundary keeps the break inside the time, as the form's order check does.
          const moved = movesEnd
            ? (time.break?.end ?? time.start) + minutes * MINUTE_MS
            : (time.break?.start ?? time.end) - minutes * MINUTE_MS;
          fc.pre(movesEnd || before.facts.length === (time.break ? 4 : 2));
          const patch = correctionFact(
            'patch',
            movesEnd ? 'clock_out' : 'clock_in',
            moved,
            contextOf(proposedActivity),
          );
          const merged = mergeCorrectionProposal('edit', before, snapshot([patch]));
          if (!merged) throw new Error('An edit of one boundary always merges.');
          const minutesLeft = movesEnd
            ? editedMinutes(time.start, moved, time)
            : editedMinutes(moved, time.end, time);
          expect(clockMinutes(merged.facts)).toEqual({ work: minutesLeft, rest: time.breakMinutes });
          for (const fact of merged.facts.filter((item) => item.activityKind !== 'break'))
            expect(fact).toMatchObject(contextOf(activity));
        },
      ),
    );
  });
});
