import { addLocalDays, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import { correctionDayOwner } from './timeline-validation';
import type { TimeCorrectionFact, TimeCorrectionRequest, TimeCorrectionSnapshot } from './types';

/** Consecutive Berlin days (`YYYY-MM-DD`), both ends inclusive. */
type ChangedDayRun = { first: string; last: string };

/**
 * The time of one person that waits for a decision, in sum: the pending
 * corrections and the pending manual submissions, their minutes before and
 * after, and their days.
 */
export type ProvisionalTimeSummary = {
  /** Pending corrections. */
  count: number;
  /** Pending manual submissions („Nachträge“). */
  submissionCount: number;
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

/** One clock fact of a pending manual submission. */
export type PendingSubmissionFact = Pick<TimeCorrectionFact, 'entryType' | 'timestamp'>;

/** Clock facts as one timeline in time order, without a person: the caller reads one person's facts only. */
function asTimeline(facts: readonly PendingSubmissionFact[]): TimeCorrectionFact[] {
  return [...facts]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map((fact) => ({
      ...fact,
      factId: fact.timestamp,
      employeeRecordId: '',
      userId: '',
      jobId: null,
      activityKind: null,
      isManual: true,
    }));
}

/**
 * The sum of one person's pending time: each correction counted by its
 * current revision and only by that person's facts, and the pending manual
 * submissions as the change they make to the accepted time of their days. A
 * submission may close or open time that accepted facts or another
 * submission hold, so the days are counted before and after as a whole.
 */
export function summarizePendingCorrections(
  pending: readonly Pick<TimeCorrectionRequest, 'revision'>[],
  subjectUserId: string,
  submissions: {
    pending: readonly (readonly PendingSubmissionFact[])[];
    /** The person's accepted facts on the days of the pending submissions. */
    acceptedOnTheirDays: readonly PendingSubmissionFact[];
  } = { pending: [], acceptedOnTheirDays: [] },
): ProvisionalTimeSummary {
  const submittedFacts = submissions.pending.flat();
  const acceptedBefore = ownerMinutes(asTimeline(submissions.acceptedOnTheirDays));
  const acceptedAfter =
    submittedFacts.length === 0
      ? acceptedBefore
      : ownerMinutes(asTimeline([...submissions.acceptedOnTheirDays, ...submittedFacts]));
  const runs = [
    ...pending.flatMap(({ revision }) => [
      ...ownerRuns(subjectFacts(revision.beforeSnapshot, subjectUserId)),
      ...ownerRuns(subjectFacts(revision.proposedSnapshot, subjectUserId)),
    ]),
    ...ownerRuns(asTimeline(submittedFacts)),
  ];
  return {
    count: pending.length,
    submissionCount: submissions.pending.length,
    beforeMinutes:
      pending.reduce(
        (total, request) =>
          total + ownerMinutes(subjectFacts(request.revision.beforeSnapshot, subjectUserId)),
        0,
      ) + acceptedBefore,
    proposedMinutes:
      pending.reduce(
        (total, request) =>
          total + ownerMinutes(subjectFacts(request.revision.proposedSnapshot, subjectUserId)),
        0,
      ) + acceptedAfter,
    days: changedDays(runs),
  };
}
