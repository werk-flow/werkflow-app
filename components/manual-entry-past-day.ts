import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
import { submitTimeCorrection } from '@/lib/time-corrections/actions';
import { TIME_CORRECTION_FAILURE_MESSAGES } from '@/lib/time-corrections/messages';
import type { TimelineFact } from '@/lib/time-corrections/timeline';
import type { CorrectionSendResult } from '@/components/correction-operation';

// The other half of „Zeit nachtragen“: own time of an earlier day waits for an
// approver, who needs the reason, so it goes in as a Zeitkorrektur that adds
// time. Same-day time stays a manual entry (use-manual-entry-form-submit.ts).

const PAST_DAY_FAILURE = 'Die Zeit konnte nicht nachgetragen werden.';

/** A retry replayed the first send, and the form changed since (correction-operation.ts). */
export const PAST_DAY_EARLIER_VERSION_SAVED =
  'Dein Nachtrag war schon mit den vorherigen Angaben eingereicht. Deine Änderungen sind nicht gespeichert. Prüfe ihn im Verlauf und zieh ihn bei Bedarf zurück.';

/**
 * Proposes the caller's own timeline of an earlier day, activity by
 * activity, with the reason.
 */
export async function submitPastDayTime(input: {
  organizationId: string;
  /** The timeline's facts for the subject the server checks again. */
  facts: (employeeRecordId: string) => TimelineFact[];
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
    proposedFacts: input.facts(baseEmployeeRecordId),
    operationId: input.operationId,
  });
  return result.success
    ? { saved: true, replayed: result.replayed, status: result.status }
    : {
        saved: false,
        message: describeFailure(result.error, TIME_CORRECTION_FAILURE_MESSAGES, PAST_DAY_FAILURE),
      };
}
