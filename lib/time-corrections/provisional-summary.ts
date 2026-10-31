import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { correctionDayOwner } from './timeline-validation';
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

/**
 * The Berlin days a snapshot touches: each fact's day, and every day an open
 * interval spans between its start and its close. An unsplit legacy interval
 * across several midnights touches the days between them too.
 */
function snapshotDays(snapshot: TimeCorrectionSnapshot): string[] {
  const days: string[] = [];
  let openDay: string | null = null;
  for (const fact of [...snapshot.facts].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    const day = formatBerlinLocalDate(correctionDayOwner(fact));
    for (let covered = openDay; covered !== null && covered < day; covered = addLocalDays(covered, 1))
      days.push(covered);
    days.push(day);
    openDay = fact.entryType === 'clock_out' ? null : day;
  }
  return days;
}

/** The sum of the pending corrections, each counted by its current revision. */
export function summarizePendingCorrections(
  pending: readonly Pick<TimeCorrectionRequest, 'revision'>[],
): ProvisionalTimeSummary {
  const days = new Set(
    pending.flatMap(({ revision }) => [
      ...snapshotDays(revision.beforeSnapshot),
      ...snapshotDays(revision.proposedSnapshot),
    ]),
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
