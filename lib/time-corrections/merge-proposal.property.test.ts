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
import { mergeApplicationCorrection, mergeCorrectionProposal } from './merge-proposal';
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

/** Recorded work without a break from `start` to `end`, split at Berlin midnight. */
function splitWorkSource(start: string, end: string) {
  const [from, to] = [Date.parse(start), Date.parse(end)];
  const time: OpenTime = {
    start: from,
    end: to,
    break: null,
    workMinutes: (to - from) / MINUTE_MS,
    breakMinutes: 0,
  };
  const activity = createActivitySelection('work', 'job-a');
  const facts = openTimeFacts(time, 'source', contextOf(activity));
  return {
    time,
    activity,
    before: { schemaVersion: 1 as const, facts: splitCorrectionFactsAtMidnight(facts) },
  };
}

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
          // The nested selection moves with the job; travel keeps its route and role.
          expect<unknown>(fact.activity).toEqual(
            allocated && recorded.activity
              ? {
                  ...recorded.activity,
                  ...(jobId === null
                    ? { allocationKind: 'unallocated', jobId: null }
                    : { allocationKind: 'job', jobId }),
                }
              : recorded.activity,
          );
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
          // The patch names another person, which a reclassification must not take over.
          const patch = correctionFact('patch', 'clock_in', 0, {
            activityKind: kind,
            employeeRecordId: 'other-record',
            userId: 'other',
          });
          const merged = mergeCorrectionProposal('reclassify', before, snapshot([patch]));
          // Travel, standby and internal time need details the transition form cannot supply.
          const refused = kind !== activity.kind && ['travel', 'standby', 'internal_activity'].includes(kind);
          expect(merged === null).toBe(refused);
          if (!merged) return;
          expect(timeOf(merged.facts)).toEqual(timeOf(before.facts));
          // The nested selection names the new activity, which the approved projection copies; work,
          // call-out and travel keep the recorded job, any other activity has none.
          const recordedJob = 'jobId' in activity ? (activity.jobId ?? null) : null;
          const jobId = ['work', 'callout', 'travel'].includes(kind) ? recordedJob : null;
          const selection = kind === activity.kind ? activity : createActivitySelection(kind, jobId);
          expect(
            merged.facts.map((fact) => [fact.userId, fact.employeeRecordId, fact.activityKind, fact.jobId]),
          ).toEqual(before.facts.map((fact) => [fact.userId, fact.employeeRecordId, kind, jobId]));
          for (const fact of merged.facts) expect<unknown>(fact.activity).toEqual(selection);
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
          // The new boundary keeps the break inside the time, as the form's order check does. A new
          // start stays before the next fact: the break, or the first 00:00 join of split time.
          const nextAfterStart = before.facts[1];
          if (!nextAfterStart) throw new Error('Recorded time has a start and an end.');
          const moved = movesEnd
            ? (time.break?.end ?? time.start) + minutes * MINUTE_MS
            : Date.parse(nextAfterStart.timestamp) - minutes * MINUTE_MS;
          // werk-flow/werkflow-planning#521: a new end of split time with a break moves the 00:00
          // clock-out instead; the known-bug case below holds that one counterexample.
          fc.pre(!(movesEnd && time.break !== null && before.facts.length > 4));
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
          // The edited boundary is the requested time; the other keeps the recorded one.
          const instants = merged.facts.map((fact) => Date.parse(fact.timestamp));
          expect([Math.min(...instants), Math.max(...instants)]).toEqual(
            movesEnd ? [time.start, moved] : [moved, time.end],
          );
          for (const fact of merged.facts.filter((item) => item.activityKind !== 'break'))
            expect(fact).toMatchObject(contextOf(activity));
        },
      ),
      {
        examples: [
          // A shift from 20:00 to 02:00 Berlin, split at midnight, whose start moves to 21:00.
          [
            splitWorkSource('2026-01-15T19:00:00Z', '2026-01-16T01:00:00Z'),
            false,
            180,
            createActivitySelection('work'),
          ],
        ],
      },
    );
  });

  // known bug: werk-flow/werkflow-planning#521 a new end of overnight time with a break moves the 00:00 clock-out
  test.failing('of only the end of overnight time with a break drops the time after the new end', () => {
    const at = (iso: string) => Date.parse(iso);
    const time: OpenTime = {
      start: at('2026-01-15T19:00:00Z'),
      end: at('2026-01-16T00:00:00Z'),
      break: { start: at('2026-01-15T20:00:00Z'), end: at('2026-01-15T20:30:00Z') },
      workMinutes: 270,
      breakMinutes: 30,
    };
    const activity = createActivitySelection('work', 'job-a');
    const before = snapshot(
      splitCorrectionFactsAtMidnight(openTimeFacts(time, 'source', contextOf(activity))),
    );
    const patch = correctionFact('patch', 'clock_out', at('2026-01-15T22:00:00Z'), contextOf(activity));
    const merged = mergeCorrectionProposal('edit', before, snapshot([patch]));
    expect(clockMinutes(merged?.facts ?? [])).toEqual({ work: 150, rest: 30 });
  });
});

// "Corrections": a correction of time that came from an approved correction changes exactly the
// interval it names. Every other interval of the application stays as it was, or it is refused.

/** An approved correction of 2–4 separate intervals, each one activity or one with a break, in time order. */
const applicationArbitrary = fc
  .array(
    fc.tuple(
      fc.integer({ min: 1, max: 120 }),
      fc.integer({ min: 30, max: 180 }),
      fc.boolean(),
      fc.constantFrom(...ACTIVITIES),
    ),
    { minLength: 2, maxLength: 4 },
  )
  .map((shapes) => {
    // 02:00 in Berlin: at most 20 hours, so no interval reaches midnight.
    let cursor = Date.parse('2026-10-14T00:00:00.000Z');
    const facts: TimeCorrectionFact[] = [];
    const intervals = shapes.map(([gap, minutes, withBreak, activity], index) => {
      const start = cursor + gap * MINUTE_MS;
      cursor = start + minutes * MINUTE_MS;
      const context = contextOf(activity);
      const from = facts.length;
      facts.push(correctionFact(`i${index}-in`, 'clock_in', start, context));
      if (withBreak) {
        facts.push(correctionFact(`i${index}-bs`, 'break_start', start + 10 * MINUTE_MS, context));
        facts.push(correctionFact(`i${index}-be`, 'break_end', start + 20 * MINUTE_MS, context));
      }
      facts.push(correctionFact(`i${index}-out`, 'clock_out', cursor, context));
      return { from, to: facts.length, withBreak };
    });
    return { before: snapshot(facts), intervals };
  });

/** The application with a drawn target fact and the interval that holds it. */
const targetedApplicationArbitrary = fc.tuple(applicationArbitrary, fc.nat()).map(([application, draw]) => {
  const target = draw % application.before.facts.length;
  const interval = application.intervals.find(({ from, to }) => target >= from && target < to);
  const fact = application.before.facts[target];
  if (!interval || !fact) throw new Error('Every fact lies in an interval.');
  return { ...application, target, fact, interval };
});

const correctApplication = (
  kind: Parameters<typeof mergeApplicationCorrection>[0]['kind'],
  before: TimeCorrectionSnapshot,
  factId: string,
  proposed: TimeCorrectionFact[],
) =>
  mergeApplicationCorrection({ kind, before, proposed: snapshot(proposed), factId, newFactIdPrefix: 'new' });

describe('A correction of one interval of an approved correction', () => {
  test('that edits changes only the time of the fact it names', () => {
    fc.assert(
      fc.property(
        targetedApplicationArbitrary,
        fc.integer({ min: 1, max: 5 }),
        ({ before, target, fact }, minutes) => {
          const timestamp = new Date(Date.parse(fact.timestamp) + minutes * MINUTE_MS).toISOString();
          const result = correctApplication('edit', before, fact.factId, [
            { ...fact, factId: 'patch', timestamp },
          ]);
          expect(result).toEqual({
            success: true,
            snapshot: snapshot(before.facts.with(target, { ...fact, timestamp })),
          });
        },
      ),
    );
  });

  test('that deletes, splits or reallocates changes only its interval, or is refused inside a session with a break', () => {
    fc.assert(
      fc.property(
        targetedApplicationArbitrary,
        fc.constantFrom('delete' as const, 'split' as const, 'reallocate' as const),
        ({ before, fact, interval }, kind) => {
          const start = before.facts[interval.from];
          const end = before.facts[interval.to - 1];
          if (!start || !end) throw new Error('An interval has a start and an end.');
          const middle = new Date(
            (Date.parse(start.timestamp) + Date.parse(end.timestamp)) / 2,
          ).toISOString();
          const proposed =
            kind === 'delete'
              ? []
              : kind === 'reallocate'
                ? [{ ...start, jobId: 'job-new' }]
                : [start, { ...end, timestamp: middle }, { ...start, timestamp: middle }, end];
          const result = correctApplication(kind, before, fact.factId, proposed);
          if (interval.withBreak) {
            expect(result).toEqual({ success: false, error: 'time_correction_multiple_intervals' });
            return;
          }
          if (!result.success) throw new Error(result.error);
          const { facts } = result.snapshot;
          const after = facts.length - (before.facts.length - interval.to);
          expect(facts.slice(0, interval.from)).toEqual(before.facts.slice(0, interval.from));
          expect(facts.slice(after)).toEqual(before.facts.slice(interval.to));
          expect(new Set(facts.map((item) => item.factId)).size).toBe(facts.length);
          // The named interval itself changed: an unchanged snapshot fails here.
          const replaced = facts.slice(interval.from, after);
          const targetIds = new Set(
            before.facts.slice(interval.from, interval.to).map((item) => item.factId),
          );
          if (kind === 'delete') {
            expect(replaced).toEqual([]);
            expect(facts.some((item) => targetIds.has(item.factId))).toBe(false);
          } else if (kind === 'split') {
            expect(replaced.map((item) => [item.entryType, item.timestamp])).toEqual([
              [start.entryType, start.timestamp],
              [end.entryType, middle],
              [start.entryType, middle],
              [end.entryType, end.timestamp],
            ]);
            // Both pieces keep the stored activity, job and details.
            for (const piece of replaced) {
              expect([piece.activityKind, piece.activity, piece.jobId]).toEqual([
                start.activityKind,
                start.activity,
                start.jobId,
              ]);
            }
          } else {
            // Only an activity that carries a job moves (merge-proposal.ts); others stay as stored.
            expect(replaced).toHaveLength(interval.to - interval.from);
            const carriesJob = new Set(['work', 'callout', 'travel']);
            replaced.forEach((piece, index) => {
              const stored = before.facts[interval.from + index];
              if (!stored) throw new Error('A reallocation keeps the interval length.');
              if (carriesJob.has(piece.activityKind ?? '')) expect(piece.jobId).toBe('job-new');
              else expect(piece).toEqual(stored);
            });
          }
        },
      ),
    );
  });

  test('that reassigns is refused, so no application is moved in part', () => {
    fc.assert(
      fc.property(targetedApplicationArbitrary, ({ before, fact }) => {
        const result = correctApplication('reassign', before, fact.factId, [
          { ...fact, employeeRecordId: 'other-record', userId: 'other' },
        ]);
        expect(result).toEqual({ success: false, error: 'time_correction_multiple_intervals' });
      }),
    );
  });
});
