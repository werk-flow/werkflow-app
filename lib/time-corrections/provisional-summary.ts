import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { correctionDayOwner } from './timeline-validation';
import type { TimeCorrectionFact, TimeCorrectionRequest, TimeCorrectionSnapshot } from './types';

/** The pending corrections of one person in sum: how many, their minutes before and after, and their days. */
export type ProvisionalTimeSummary = {
  count: number;
  beforeMinutes: number;
  proposedMinutes: number;
  /** The Berlin days (`YYYY-MM-DD`) the pending corrections change, in order. */
  days: string[];
};

/**
 * The subject's facts of a snapshot, in time order. A reassignment keeps two
 * people's facts in one snapshot; the summary of one person counts only theirs.
 */
function subjectFacts(snapshot: TimeCorrectionSnapshot, subjectUserId: string): TimeCorrectionFact[] {
  return snapshot.facts
    .filter((fact) => fact.userId === subjectUserId)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function ownerMinutes(facts: readonly TimeCorrectionFact[]): number {
  let activeStart: number | null = null;
  let minutes = 0;
  for (const fact of facts) {
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
function ownerDays(facts: readonly TimeCorrectionFact[]): string[] {
  const days: string[] = [];
  let openDay: string | null = null;
  for (const fact of facts) {
    const day = formatBerlinLocalDate(correctionDayOwner(fact));
    for (let covered = openDay; covered !== null && covered < day; covered = addLocalDays(covered, 1))
      days.push(covered);
    days.push(day);
    openDay = fact.entryType === 'clock_out' ? null : day;
  }
  return days;
}

/** The sum of one person's pending corrections, each counted by its current revision and only by that person's facts. */
export function summarizePendingCorrections(
  pending: readonly Pick<TimeCorrectionRequest, 'revision'>[],
  subjectUserId: string,
): ProvisionalTimeSummary {
  const days = new Set(
    pending.flatMap(({ revision }) => [
      ...ownerDays(subjectFacts(revision.beforeSnapshot, subjectUserId)),
      ...ownerDays(subjectFacts(revision.proposedSnapshot, subjectUserId)),
    ]),
  );
  return {
    count: pending.length,
    beforeMinutes: pending.reduce(
      (total, request) => total + ownerMinutes(subjectFacts(request.revision.beforeSnapshot, subjectUserId)),
      0,
    ),
    proposedMinutes: pending.reduce(
      (total, request) =>
        total + ownerMinutes(subjectFacts(request.revision.proposedSnapshot, subjectUserId)),
      0,
    ),
    days: [...days].sort(),
  };
}
