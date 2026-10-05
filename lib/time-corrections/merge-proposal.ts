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
