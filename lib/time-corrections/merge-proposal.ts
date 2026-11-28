import type { ActionResult } from '@/lib/action-result';
import { getLocalDayStart } from '@/lib/date-time/berlin';
import { isSameActivitySelection } from '@/lib/time-tracking/clock-actions';
import type { TimeActivitySelection } from '@/lib/time-tracking/types';
import type { TimeCorrectionFact, TimeCorrectionSnapshot } from './types';
import type { SubmitTimeCorrectionInput } from './validation';

/**
 * The source's facts with a correction applied. An edit with a `targetIndex`
 * changes that fact; without one, the first fact of the patch's type.
 */
export function mergeCorrectionProposal(
  kind: SubmitTimeCorrectionInput['kind'],
  before: TimeCorrectionSnapshot,
  proposed: TimeCorrectionSnapshot,
  targetIndex?: number,
): TimeCorrectionSnapshot | null {
  const patch = proposed.facts[0];
  if (!patch || before.facts.length === 0) return proposed;
  if (kind === 'reclassify' || kind === 'reallocate') {
    const facts: TimeCorrectionFact[] = [];
    for (const fact of before.facts) {
      if (!fact.activity) {
        facts.push({
          ...fact,
          ...(kind === 'reclassify' ? { activityKind: patch.activityKind } : { jobId: patch.jobId }),
        });
        continue;
      }
      const activityKind = kind === 'reclassify' ? patch.activityKind : fact.activity.kind;
      // A transition-only form cannot supply new travel, standby or internal context.
      if (
        !activityKind ||
        (activityKind !== fact.activity.kind && !['work', 'callout', 'break'].includes(activityKind))
      )
        return null;
      if (kind === 'reclassify' && before.facts.some((other) => other.activity?.kind !== fact.activity?.kind))
        return null;
      const jobId = kind === 'reallocate' ? patch.jobId : fact.jobId;
      const allocation = jobId
        ? { allocationKind: 'job' as const, jobId }
        : { allocationKind: 'unallocated' as const, jobId: null };
      const activity: TimeActivitySelection =
        activityKind === 'work' || activityKind === 'callout'
          ? { kind: activityKind, ...allocation }
          : activityKind === 'break'
            ? { kind: 'break', allocationKind: 'none' }
            : fact.activity.kind === 'travel'
              ? { ...fact.activity, ...allocation }
              : fact.activity;
      if (kind === 'reallocate' && !['work', 'callout', 'travel'].includes(activity.kind)) {
        facts.push(fact);
        continue;
      }
      facts.push({
        ...fact,
        activity,
        activityKind: activity.kind,
        jobId: 'jobId' in activity ? (activity.jobId ?? null) : null,
      });
    }
    return { schemaVersion: 1, facts };
  }
  if (kind === 'reassign') {
    return {
      schemaVersion: 1,
      facts: before.facts.map((fact) => ({
        ...fact,
        employeeRecordId: patch.employeeRecordId,
        userId: patch.userId,
      })),
    };
  }
  if (kind !== 'edit') return proposed;
  return editSource(before, proposed, patch, targetIndex);
}

/**
 * Whether a clock-out and the clock-in after it only split one activity at a
 * Europe/Berlin midnight: the same instant on a midnight, the same context.
 */
function joinsAtMidnight(
  close: TimeCorrectionFact | undefined,
  open: TimeCorrectionFact | undefined,
): boolean {
  return (
    close?.entryType === 'clock_out' &&
    open?.entryType === 'clock_in' &&
    Date.parse(open.timestamp) === Date.parse(close.timestamp) &&
    getLocalDayStart(new Date(close.timestamp)).getTime() === Date.parse(close.timestamp) &&
    sharesOneContext([close, open])
  );
}

/**
 * An applied snapshot's intervals as index ranges [from, to): each runs to a
 * clock-out, across a midnight that only splits its activity.
 */
function appliedIntervals(facts: readonly TimeCorrectionFact[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let from = 0;
  facts.forEach((fact, index) => {
    const next = facts[index + 1];
    if (next && (fact.entryType !== 'clock_out' || joinsAtMidnight(fact, next))) return;
    ranges.push([from, index + 1]);
    from = index + 1;
  });
  return ranges;
}

/**
 * A correction of one interval of an approved correction: the interval of
 * the named fact changes, every other interval stays as it was. A change that
 * would reach past one activity is refused: a reassignment of part of the
 * application, or a deletion, split or new activity or job of one activity
 * inside a session with breaks. New facts get ids from `newFactIdPrefix`, so
 * none collides with a sibling's.
 */
export function mergeApplicationCorrection(input: {
  kind: SubmitTimeCorrectionInput['kind'];
  before: TimeCorrectionSnapshot;
  proposed: TimeCorrectionSnapshot;
  factId: string | undefined;
  newFactIdPrefix: string;
}): ActionResult<{ snapshot: TimeCorrectionSnapshot }> {
  const { kind, before, proposed } = input;
  const matches = before.facts.flatMap((fact, index) => (fact.factId === input.factId ? [index] : []));
  const target = matches.length === 1 ? matches[0] : undefined;
  const intervals = appliedIntervals(before.facts);
  const range = intervals.find(([from, to]) => target !== undefined && target >= from && target < to);
  if (target === undefined || !range) return { success: false, error: 'source_not_found' };
  const [from, to] = range;
  const interval = before.facts.slice(from, to);
  // One activity: a start and its end, or clock pairs that only midnight splits.
  const oneActivity =
    interval.length === 2 || interval.every((fact) => ['clock_in', 'clock_out'].includes(fact.entryType));
  const reachesPast =
    kind === 'reassign' ? !oneActivity || intervals.length > 1 : kind !== 'edit' && !oneActivity;
  if (reachesPast) return { success: false, error: 'time_correction_multiple_intervals' };
  const merged = mergeCorrectionProposal(
    kind,
    { schemaVersion: 1, facts: interval },
    proposed,
    target - from,
  );
  if (!merged) return { success: false, error: 'activity_context_required' };
  // A fact keeps its id while it is the interval's own and not taken yet.
  const freeIds = new Set(interval.map((fact) => fact.factId));
  return {
    success: true,
    snapshot: {
      schemaVersion: 1,
      facts: [
        ...before.facts.slice(0, from),
        ...merged.facts.map((fact, index) =>
          freeIds.delete(fact.factId) ? fact : { ...fact, factId: `${input.newFactIdPrefix}:${index}` },
        ),
        ...before.facts.slice(to),
      ],
    },
  };
}

/** Facts of one activity context: the same activity, job and person throughout. */
function sharesOneContext(facts: readonly TimeCorrectionFact[]): boolean {
  const [first] = facts;
  return facts.every(
    (fact) =>
      fact.activityKind === first?.activityKind &&
      fact.jobId === first?.jobId &&
      fact.userId === first?.userId &&
      fact.employeeRecordId === first?.employeeRecordId &&
      // The qualifiers too: a travel role or route of a later piece must not be lost.
      ((!fact.activity && !first?.activity) || isSameActivitySelection(fact.activity, first?.activity)),
  );
}

/**
 * Whether the facts are one span that only midnight splits: at least one join, and every join of a
 * clock_out and the next clock_in sits at one instant on a Europe/Berlin midnight. A daytime join
 * anywhere makes them separate pieces of work.
 */
function continuesAcrossMidnight(facts: readonly TimeCorrectionFact[]): boolean {
  const closes = facts.flatMap((fact, index) =>
    fact.entryType === 'clock_out' && index < facts.length - 1 ? [index] : [],
  );
  return closes.length > 0 && closes.every((index) => joinsAtMidnight(facts[index], facts[index + 1]));
}

// An edit changes times only; the source's activity and job stay.
function editSource(
  before: TimeCorrectionSnapshot,
  proposed: TimeCorrectionSnapshot,
  patch: TimeCorrectionFact,
  target: number | undefined,
): TimeCorrectionSnapshot {
  const [opening] = before.facts;
  const [start, end] = proposed.facts;
  // One whole pair for a source of whole pairs (a span that may run over
  // several days) replaces it, so no later day piece survives the edit.
  if (
    opening &&
    proposed.facts.length === 2 &&
    start?.entryType === 'clock_in' &&
    end?.entryType === 'clock_out' &&
    before.facts.every((fact, index) => fact.entryType === (index % 2 === 0 ? 'clock_in' : 'clock_out')) &&
    before.facts.length % 2 === 0 &&
    sharesOneContext(before.facts)
  ) {
    return {
      schemaVersion: 1,
      facts: [start, end].map((fact) => ({
        ...opening,
        factId: fact.factId,
        entryType: fact.entryType,
        timestamp: fact.timestamp,
      })),
    };
  }
  const closing = before.facts.at(-1);
  // A new end of a source that spans several days ends the span there: the
  // day pieces after it go, and submission splits the result at midnight again.
  if (
    proposed.facts.length === 1 &&
    patch.entryType === 'clock_out' &&
    closing?.entryType === 'clock_out' &&
    (target === undefined || target === before.facts.length - 1) &&
    opening &&
    Date.parse(patch.timestamp) > Date.parse(opening.timestamp) &&
    sharesOneContext(before.facts) &&
    continuesAcrossMidnight(before.facts)
  ) {
    return {
      schemaVersion: 1,
      facts: [
        // The source's own close goes too, also when the new end is later.
        ...before.facts
          .slice(0, -1)
          .filter((fact) => Date.parse(fact.timestamp) < Date.parse(patch.timestamp)),
        { ...closing, timestamp: patch.timestamp },
      ],
    };
  }
  const exactIndex = before.facts.findIndex((fact) => fact.entryType === patch.entryType);
  const directionIndex = before.facts.findIndex(
    (fact) =>
      ['clock_in', 'break_start'].includes(fact.entryType) ===
      ['clock_in', 'break_start'].includes(patch.entryType),
  );
  const targetIndex = target ?? (exactIndex >= 0 ? exactIndex : directionIndex);
  if (targetIndex < 0) return proposed;
  return {
    schemaVersion: 1,
    facts: before.facts.map((fact, index) =>
      index === targetIndex ? { ...fact, timestamp: patch.timestamp } : fact,
    ),
  };
}
