import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { correctionDayOwner } from './timeline-validation';
import type { TimeCorrectionFact, TimeCorrectionRequest, TimeCorrectionSnapshot } from './types';

/** Consecutive Berlin days (`YYYY-MM-DD`), both ends inclusive. */
type ChangedDayRun = { first: string; last: string };

/** The pending corrections of one person in sum: how many, their minutes before and after, and their days. */
export type ProvisionalTimeSummary = {
  count: number;
  beforeMinutes: number;
  proposedMinutes: number;
  /** The Berlin days the pending corrections change, in order; a longer run than a week as one run. */
  days: (string | ChangedDayRun)[];
};

/**
 * The longest interval named day by day. A proposal stays open over midnight
 * for at most 24 hours, so only a legacy interval runs longer, and the
 * summary's work stays bounded by the stored facts, not the days between them.
 */
const LISTED_DAYS = 7;

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
 * The Berlin days a snapshot touches, as runs: each fact's day, and every day
 * an open interval spans from its start to its close. An unsplit legacy
 * interval across several midnights touches the days between them too.
 */
function ownerRuns(facts: readonly TimeCorrectionFact[]): ChangedDayRun[] {
  const runs: ChangedDayRun[] = [];
  let openDay: string | null = null;
  for (const fact of facts) {
    const day = formatBerlinLocalDate(correctionDayOwner(fact));
    runs.push({ first: openDay !== null && openDay < day ? openDay : day, last: day });
    openDay = fact.entryType === 'clock_out' ? null : day;
  }
  return runs;
}

/** The days of the runs, once each and in order: a run of up to a week day by day, a longer one whole. */
function changedDays(runs: readonly ChangedDayRun[]): (string | ChangedDayRun)[] {
  const days = new Set<string>();
  const longRuns: ChangedDayRun[] = [];
  for (const run of [...runs].sort((left, right) => left.first.localeCompare(right.first))) {
    if (addLocalDays(run.first, LISTED_DAYS) > run.last) {
      for (let day = run.first; day <= run.last; day = addLocalDays(day, 1)) days.add(day);
      continue;
    }
    const previous = longRuns.at(-1);
    if (!previous || run.first > previous.last) longRuns.push({ ...run });
    else if (run.last > previous.last) previous.last = run.last;
  }
  const listed = [...days].filter((day) => !longRuns.some((run) => run.first <= day && day <= run.last));
  const firstDay = (entry: string | ChangedDayRun) => (typeof entry === 'string' ? entry : entry.first);
  return [...listed, ...longRuns].sort((left, right) => firstDay(left).localeCompare(firstDay(right)));
}

/** The sum of one person's pending corrections, each counted by its current revision and only by that person's facts. */
export function summarizePendingCorrections(
  pending: readonly Pick<TimeCorrectionRequest, 'revision'>[],
  subjectUserId: string,
): ProvisionalTimeSummary {
  const runs = pending.flatMap(({ revision }) => [
    ...ownerRuns(subjectFacts(revision.beforeSnapshot, subjectUserId)),
    ...ownerRuns(subjectFacts(revision.proposedSnapshot, subjectUserId)),
  ]);
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
    days: changedDays(runs),
  };
}
