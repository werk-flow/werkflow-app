// The calendar correction dialog's send (calendar-time-correction-dialog.tsx):
// one operation per draft, through the shared rule of correction-operation.ts.

import { describeFailure } from '@/lib/action-messages';
import { TIME_CORRECTION_FAILURE_MESSAGES } from '@/lib/time-corrections/messages';
import type { TimeCorrectionResult } from '@/lib/time-corrections/types';
import type { SubmitTimeCorrectionInput } from '@/lib/time-corrections/validation';
import { sendUnderOperation, type CorrectionOperation } from '@/components/correction-operation';

// The correction sentences every surface shares, plus the ones that name the
// calendar; the shared codes (`invalid_input`, `period_closed`, ...) take their
// sentence from lib/action-messages.ts.
const errors: Readonly<Partial<Record<string, string>>> = {
  ...TIME_CORRECTION_FAILURE_MESSAGES,
  calendar_incomplete_source:
    'Dieser Block ist noch aktiv oder zeigt nur einen Teil der ursprünglichen Buchung. Bitte korrigiere ihn in der Zeiterfassung.',
  time_correction_stale_source:
    'Die Buchung wurde inzwischen geändert. Bitte lade den Kalender neu und prüfe die Änderung.',
  time_correction_multiple_application_sources:
    'Dieser Block enthält mehrere frühere Korrekturen. Bitte bearbeite sie einzeln in der Zeiterfassung.',
};

/** What the dialog does with an answer: close on a save, stay open on anything else. */
type CalendarCorrectionAnswer =
  | { kind: 'saved'; message: string }
  | { kind: 'earlier-version-saved'; message: string }
  | { kind: 'failed'; message: string };

/**
 * Sends the draft's correction under its operation and returns what the
 * dialog says. The moved times are fixed for a draft, so the reason is the
 * content a retry can change: a replay after the reason changed means the
 * move stands with the earlier reason. A thrown send throws on: its outcome
 * is unknown and the operation keeps its reason.
 */
export async function sendCalendarTimeCorrection(
  operationRef: { current: CorrectionOperation | null },
  submission: Omit<SubmitTimeCorrectionInput, 'operationId'>,
  submit: (input: SubmitTimeCorrectionInput) => Promise<TimeCorrectionResult>,
): Promise<CalendarCorrectionAnswer> {
  const outcome = await sendUnderOperation(operationRef, submission.reason, async (operationId) => {
    const result = await submit({ ...submission, operationId });
    return result.success
      ? { saved: true, replayed: result.replayed, status: result.status }
      : {
          saved: false,
          message: describeFailure(
            result.error,
            errors,
            'Die Korrektur konnte nicht gespeichert werden. Bitte prüfe die Buchung in der Zeiterfassung.',
          ),
        };
  });
  if (outcome.kind === 'failed') return outcome;
  if (outcome.kind === 'earlier-version-saved') {
    return {
      kind: 'earlier-version-saved',
      message:
        'Deine Korrektur war schon mit dem vorherigen Grund gespeichert. Dein geänderter Grund ist nicht gespeichert. Prüfe die Korrektur in der Zeiterfassung.',
    };
  }
  return {
    kind: 'saved',
    message:
      outcome.status === 'approved'
        ? 'Die Zeit wurde korrigiert.'
        : 'Die Korrektur wurde zur Prüfung eingereicht.',
  };
}
