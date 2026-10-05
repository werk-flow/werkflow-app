import type { TimeCorrectionKind } from '@/lib/time-corrections/types';
import type { TimeEntry, TimeSegmentKind } from '@/lib/time-tracking/types';

type TimeCorrectionProposedFactsInput = {
  kind: TimeCorrectionKind;
  entry: TimeEntry | undefined;
  /** The person the proposed facts belong to after the correction. */
  baseEmployeeRecordId: string;
  /** A job id, or 'none' for time without a job. */
  jobId: string;
  activityKind: TimeSegmentKind;
  startAt: string;
  splitAt: string;
  endAt: string;
};

type TimeCorrectionProposedFact = {
  factId: string;
  employeeRecordId: string;
  entryType: TimeEntry['entryType'];
  timestamp: string;
  jobId: string | null;
  activityKind: TimeSegmentKind;
};

// The clock facts a correction proposes: a start/end pair for added time, two
// adjoining pairs for a split, one changed fact for an edit of an existing
// entry, and none for a deletion.
export function buildTimeCorrectionProposedFacts({
  kind,
  entry,
  baseEmployeeRecordId,
  jobId,
  activityKind,
  startAt,
  splitAt,
  endAt,
}: TimeCorrectionProposedFactsInput): TimeCorrectionProposedFact[] {
  const makeFact = (
    factId: string,
    entryType: TimeEntry['entryType'],
    localValue: string,
  ): TimeCorrectionProposedFact => ({
    factId,
    employeeRecordId: baseEmployeeRecordId,
    entryType,
    timestamp: new Date(localValue).toISOString(),
    jobId: jobId === 'none' ? null : jobId,
    activityKind,
  });
  let proposedFacts: TimeCorrectionProposedFact[] = [];
  if (kind === 'add' || kind === 'missed_clock') {
    proposedFacts = [makeFact('start', 'clock_in', startAt), makeFact('end', 'clock_out', endAt)];
  } else if (kind === 'split') {
    proposedFacts = [
      makeFact('first-start', 'clock_in', startAt),
      makeFact('first-end', 'clock_out', splitAt),
      makeFact('second-start', 'clock_in', splitAt),
      makeFact('second-end', 'clock_out', endAt),
    ];
  } else if (kind !== 'delete' && entry) {
    proposedFacts = [makeFact('changed', entry.entryType, startAt)];
  }
  return proposedFacts;
}
