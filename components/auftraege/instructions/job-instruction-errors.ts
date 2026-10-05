import { describeFailure, SHARED_FAILURE_MESSAGES } from '@/lib/action-messages';

export const ERROR_MESSAGES = {
  content_required: 'Bitte gib einen Text für den Punkt ein.',
  create_failed: 'Der Punkt konnte nicht erstellt werden.',
  update_failed: 'Der Punkt konnte nicht gespeichert werden.',
  delete_failed: 'Der Punkt konnte nicht gelöscht werden.',
  toggle_failed: 'Der Status konnte nicht geändert werden.',
  instruction_predecessor_incomplete: 'Schließe zuerst alle vorausgehenden Einträge ab.',
  instruction_item_stale_version: 'Der Eintrag wurde inzwischen geändert. Die Ansicht wird aktualisiert.',
  reorder_failed: 'Die Reihenfolge der Punkte konnte nicht gespeichert werden.',
  invalid_reorder: 'Die Reihenfolge der Punkte ist nicht mehr aktuell.',
  item_not_found: 'Der Eintrag wurde nicht gefunden.',
  job_not_found: 'Der Auftrag wurde nicht gefunden.',
} satisfies Record<string, string>;

export function getJobInstructionErrorMessage(error: string | undefined): string {
  const unexpected = SHARED_FAILURE_MESSAGES.unexpected_error;
  if (!error) return unexpected;
  return describeFailure(error, ERROR_MESSAGES, unexpected);
}
