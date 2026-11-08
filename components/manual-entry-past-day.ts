import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { submitTimeCorrection } from '@/lib/time-corrections/actions';
import { TIME_CORRECTION_FAILURE_MESSAGES } from '@/lib/time-corrections/messages';
import { buildTimeCorrectionProposedFacts } from '@/components/zeiterfassung/time-correction-dialog-facts';
import type { CorrectionSendResult } from '@/components/correction-operation';

// The other half of „Zeit nachtragen“: own time of an earlier day waits for an
// approver, who needs the reason, so it goes in as a Zeitkorrektur that adds
// time. Same-day time stays a manual entry (use-manual-entry-form-submit.ts).

const PAST_DAY_FAILURE = 'Die Zeit konnte nicht nachgetragen werden.';

/** A retry replayed the first send, and the form changed since (correction-operation.ts). */
export const PAST_DAY_EARLIER_VERSION_SAVED =
  'Dein Nachtrag war schon mit den vorherigen Angaben eingereicht. Deine Änderungen sind nicht gespeichert. Prüfe ihn im Verlauf und zieh ihn bei Bedarf zurück.';

/**
 * Proposes the caller's own work from the clock-in to the clock-out of an
 * earlier day, with the reason.
 */
export async function submitPastDayTime(input: {
  organizationId: string;
  dateIso: string;
  clockInTime: string;
  clockOutTime: string;
  /** The job, or '' for time without one. */
  jobId: string;
  reason: string;
  operationId: string;
}): Promise<CorrectionSendResult> {
  // The caller's own employee record is the subject; the server checks it again.
  const options = await readInBackground('time-correction-form-options', {
    organizationId: input.organizationId,
  });
  if (!options.success) return { saved: false, message: PAST_DAY_FAILURE };
  const baseEmployeeRecordId = options.options.currentEmployeeRecordId;
  const result = await submitTimeCorrection({
    organizationId: input.organizationId,
    subjectEmployeeRecordId: baseEmployeeRecordId,
    kind: 'add',
    reason: input.reason,
    source: null,
    proposedFacts: buildTimeCorrectionProposedFacts({
      kind: 'add',
      entry: undefined,
      baseEmployeeRecordId,
      jobId: input.jobId || 'none',
      activityKind: 'work',
      startAt: `${input.dateIso}T${input.clockInTime}`,
      splitAt: `${input.dateIso}T${input.clockInTime}`,
      endAt: `${input.dateIso}T${input.clockOutTime}`,
    }),
    operationId: input.operationId,
  });
  return result.success
    ? { saved: true, replayed: result.replayed, status: result.status }
    : {
        saved: false,
        message: describeFailure(result.error, TIME_CORRECTION_FAILURE_MESSAGES, PAST_DAY_FAILURE),
      };
}
