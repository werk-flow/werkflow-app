import { getLocalDayStart } from '@/lib/date-time/berlin';
import { isSameActivitySelection } from '@/lib/time-tracking/clock-actions';
import type { TimeActivitySelection } from '@/lib/time-tracking/types';
import type { TimeCorrectionFact, TimeCorrectionSnapshot } from './types';
import type { SubmitTimeCorrectionInput } from './validation';

export function mergeCorrectionProposal(
  kind: SubmitTimeCorrectionInput['kind'],
  before: TimeCorrectionSnapshot,
  proposed: TimeCorrectionSnapshot,
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
  return editSource(before, proposed, patch);
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
  const joins = facts.flatMap((fact, index): Array<[TimeCorrectionFact, TimeCorrectionFact]> => {
    const next = facts[index + 1];
    return fact.entryType === 'clock_out' && next ? [[fact, next]] : [];
  });
  return (
    joins.length > 0 &&
    joins.every(
      ([close, open]) =>
        open.entryType === 'clock_in' &&
        Date.parse(open.timestamp) === Date.parse(close.timestamp) &&
        getLocalDayStart(new Date(close.timestamp)).getTime() === Date.parse(close.timestamp),
    )
  );
}

// An edit changes times only; the source's activity and job stay.
function editSource(
  before: TimeCorrectionSnapshot,
  proposed: TimeCorrectionSnapshot,
  patch: TimeCorrectionFact,
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
  const targetIndex = exactIndex >= 0 ? exactIndex : directionIndex;
  if (targetIndex < 0) return proposed;
  return {
    schemaVersion: 1,
    facts: before.facts.map((fact, index) =>
      index === targetIndex ? { ...fact, timestamp: patch.timestamp } : fact,
    ),
  };
}
