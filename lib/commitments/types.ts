import type { Database } from '@/lib/supabase/database.types';

export type CustomerCommitmentSource =
  Database['public']['Enums']['customer_commitment_source'];
export type CustomerCommitmentStatus =
  Database['public']['Enums']['customer_commitment_status'];

export const COMMITMENT_SOURCE_LABELS: Record<CustomerCommitmentSource, string> =
  {
    telefonisch: 'Telefonisch vereinbart',
    vor_ort: 'Vor Ort vereinbart',
    schriftlich_manuell: 'Schriftlich vereinbart (manuell erfasst)',
    sonstige: 'Sonstige Vereinbarung',
  };

// A commitment is a manually recorded fact: WHO recorded WHEN that WHICH
// window was agreed via WHICH channel. It proves nothing about delivery,
// consent, or written confirmation — actual outbound messages are P1-46.
export type CustomerCommitment = {
  id: string;
  occurrenceId: string;
  committedDate: string;
  windowStartTime: string | null;
  windowEndTime: string | null;
  source: CustomerCommitmentSource;
  contactId: string | null;
  contactName: string | null;
  status: CustomerCommitmentStatus;
  withdrawalReason: string | null;
  recordedAt: string;
  recordedByName: string | null;
};

export type CommitmentScheduleFacts = {
  timeKind: 'timed' | 'all_day';
  /** Berlin-local start date (YYYY-MM-DD). */
  localStartDate: string;
  /** Berlin-local start time (HH:MM) for timed occurrences. */
  localStartTime: string | null;
};

/**
 * The internal plan and the recorded promise are separate facts; moving the
 * plan never rewrites the commitment. This check surfaces the mismatch that
 * then requires an explicit re-commit or withdrawal.
 */
export function isCommitmentMismatch(
  commitment: Pick<
    CustomerCommitment,
    'committedDate' | 'windowStartTime' | 'windowEndTime'
  >,
  schedule: CommitmentScheduleFacts
): boolean {
  if (commitment.committedDate !== schedule.localStartDate) return true;
  if (
    commitment.windowStartTime !== null &&
    commitment.windowEndTime !== null &&
    schedule.timeKind === 'timed' &&
    schedule.localStartTime !== null
  ) {
    // Only the visit's ARRIVAL time is checked against the promised window
    // (inclusive bounds); the visit's end or duration is deliberately not
    // evaluated — a window is an arrival promise, not a completion promise.
    const start = commitment.windowStartTime.slice(0, 5);
    const end = commitment.windowEndTime.slice(0, 5);
    return schedule.localStartTime < start || schedule.localStartTime > end;
  }
  return false;
}

export function formatCommitmentWindow(
  commitment: Pick<
    CustomerCommitment,
    'committedDate' | 'windowStartTime' | 'windowEndTime'
  >
): string {
  const [year, month, day] = commitment.committedDate.split('-');
  const dateText = `${day}.${month}.${year}`;
  if (commitment.windowStartTime && commitment.windowEndTime) {
    return `${dateText}, ${commitment.windowStartTime.slice(0, 5)}–${commitment.windowEndTime.slice(0, 5)} Uhr`;
  }
  return dateText;
}

export function commitmentErrorMessage(error: string): string {
  return (
    COMMITMENT_ERROR_MESSAGES[error] ?? COMMITMENT_ERROR_MESSAGES.unexpected_error
  );
}

export const COMMITMENT_ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Die Eingaben sind unvollständig oder ungültig.',
  commitment_occurrence_not_found: 'Der geplante Besuch wurde nicht gefunden.',
  commitment_occurrence_not_scheduled:
    'Nur eingeplante Besuche können eine Kundenzusage erhalten.',
  commitment_not_found: 'Die Kundenzusage wurde nicht gefunden.',
  withdrawal_reason_invalid:
    'Bitte eine Begründung mit 3 bis 1000 Zeichen angeben.',
  not_authorized: 'Keine Berechtigung für diese Aktion.',
  load_failed: 'Die Kundenzusagen konnten nicht geladen werden.',
  update_failed: 'Die Änderung konnte nicht gespeichert werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};
