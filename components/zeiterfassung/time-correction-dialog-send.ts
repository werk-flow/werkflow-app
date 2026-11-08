// The Zeitkorrektur dialog's send (use-time-correction-dialog.ts): one
// operation per opening, through the shared rule of correction-operation.ts.

import { describeFailure } from '@/lib/action-messages';
import { TIME_CORRECTION_FAILURE_MESSAGES } from '@/lib/time-corrections/messages';
import type { TimeCorrectionResult } from '@/lib/time-corrections/types';
import type { SubmitTimeCorrectionInput } from '@/lib/time-corrections/validation';
import {
  sendUnderOperation,
  type CorrectionOperation,
  type CorrectionSendOutcome,
} from '@/components/correction-operation';

export const TIME_CORRECTION_SAVE_FAILURE = 'Die Korrektur konnte nicht gespeichert werden.';

/** A retry replayed the opening's first send, and the dialog changed since. */
const TIME_CORRECTION_EARLIER_VERSION_SAVED =
  'Deine Korrektur war schon mit den vorherigen Angaben gespeichert. Deine Änderungen sind nicht gespeichert. Prüfe die Zeiten, bevor du erneut korrigierst.';

type TimeCorrectionSubmission = Omit<SubmitTimeCorrectionInput, 'operationId'>;

/** What the dialog says about an answer: a save closes it with a banner, anything else stays in it. */
function dialogAnswer(outcome: CorrectionSendOutcome): { saved: boolean; message: string } {
  if (outcome.kind === 'failed') return { saved: false, message: outcome.message };
  if (outcome.kind === 'earlier-version-saved') {
    return { saved: false, message: TIME_CORRECTION_EARLIER_VERSION_SAVED };
  }
  return {
    saved: true,
    message:
      outcome.status === 'approved'
        ? 'Die Zeit wurde korrigiert.'
        : 'Die Korrektur wurde zur Prüfung eingereicht.',
  };
}

/**
 * Sends the dialog's correction under the opening's operation and returns
 * what the dialog says. A thrown send throws on: its outcome is unknown and
 * the operation keeps its content.
 */
export async function sendTimeCorrection(
  operationRef: { current: CorrectionOperation | null },
  submission: TimeCorrectionSubmission,
  submit: (input: SubmitTimeCorrectionInput) => Promise<TimeCorrectionResult>,
): Promise<{ saved: boolean; message: string }> {
  const outcome = await sendUnderOperation(operationRef, JSON.stringify(submission), async (operationId) => {
    const result = await submit({ ...submission, operationId });
    return result.success
      ? { saved: true, replayed: result.replayed, status: result.status }
      : {
          saved: false,
          message: describeFailure(
            result.error,
            TIME_CORRECTION_FAILURE_MESSAGES,
            TIME_CORRECTION_SAVE_FAILURE,
          ),
        };
  });
  return dialogAnswer(outcome);
}
