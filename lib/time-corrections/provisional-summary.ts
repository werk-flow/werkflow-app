import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { TimeCorrectionRequest, TimeCorrectionSnapshot } from './types';

/** The pending corrections of one person in sum: how many, their minutes before and after, and their days. */
export type ProvisionalTimeSummary = {
  count: number;
  beforeMinutes: number;
  proposedMinutes: number;
  /** The Berlin days (`YYYY-MM-DD`) the pending corrections change, in order. */
  days: string[];
};

function snapshotMinutes(snapshot: TimeCorrectionSnapshot): number {
  let activeStart: number | null = null;
  let minutes = 0;
  for (const fact of [...snapshot.facts].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    const timestamp = Date.parse(fact.timestamp);
    if (fact.entryType === 'clock_in' || fact.entryType === 'break_end') {
      activeStart = timestamp;
    } else if (activeStart !== null) {
      minutes += Math.max(0, Math.round((timestamp - activeStart) / 60_000));
      activeStart = null;
    }
  }
  return minutes;
}

/** The sum of the pending corrections, each counted by its current revision. */
export function summarizePendingCorrections(
  pending: readonly Pick<TimeCorrectionRequest, 'revision'>[],
): ProvisionalTimeSummary {
  const days = new Set(
    pending.flatMap(({ revision }) =>
      [...revision.beforeSnapshot.facts, ...revision.proposedSnapshot.facts].map((fact) =>
        formatBerlinLocalDate(fact.timestamp),
      ),
    ),
  );
  return {
    count: pending.length,
    beforeMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.beforeSnapshot),
      0,
    ),
    proposedMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.proposedSnapshot),
      0,
    ),
    days: [...days].sort(),
  };
}
