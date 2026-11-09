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

// The clock facts a correction of an entry proposes: two adjoining pairs for
// a split, one changed fact for any other change, and none for a deletion.
// Added time carries a timeline instead (lib/time-corrections/timeline.ts).
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
  if (kind === 'split') {
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
