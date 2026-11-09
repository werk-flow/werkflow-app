import { getLocalDayStart } from '@/lib/date-time/berlin';
import type { TimeSegmentKind } from '@/lib/time-tracking/types';
import type { TimeCorrectionFact } from './types';

/** One activity of a correction snapshot as a reviewer reads it; an open one has no end. */
export type SnapshotSegment = {
  startedAt: string;
  endedAt: string | null;
  activityKind: TimeSegmentKind;
  jobId: string | null;
};

function isBerlinMidnight(instant: string): boolean {
  const date = new Date(instant);
  return getLocalDayStart(date).getTime() === date.getTime();
}

/**
 * The activities a snapshot's facts record, in order, the way the time
 * account reads them: each fact but a clock-out starts an activity that runs
 * until the next fact. The midnight split of an overnight proposal reads as
 * one activity again, so the reviewer sees what was proposed.
 */
export function snapshotSegments(facts: readonly TimeCorrectionFact[]): SnapshotSegment[] {
  const segments: SnapshotSegment[] = [];
  let active: Omit<SnapshotSegment, 'endedAt'> | null = null;
  const close = (endedAt: string | null): void => {
    if (!active || (endedAt !== null && Date.parse(endedAt) <= Date.parse(active.startedAt))) return;
    const previous = segments.at(-1);
    if (
      previous?.endedAt === active.startedAt &&
      isBerlinMidnight(active.startedAt) &&
      previous.activityKind === active.activityKind &&
      previous.jobId === active.jobId
    ) {
      previous.endedAt = endedAt;
      return;
    }
    segments.push({ ...active, endedAt });
  };
  for (const fact of facts) {
    close(fact.timestamp);
    active =
      fact.entryType === 'clock_out'
        ? null
        : {
            startedAt: fact.timestamp,
            activityKind:
              fact.entryType === 'break_start'
                ? 'break'
                : (fact.activity?.kind ?? fact.activityKind ?? 'work'),
            jobId: fact.entryType === 'break_start' ? null : fact.jobId,
          };
  }
  close(null);
  return segments;
}
