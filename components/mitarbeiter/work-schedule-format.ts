import { describeFailure } from '@/lib/action-messages';

/** Schedule-owned failure sentences; shared codes come from `describeFailure`. */
export const SCHEDULE_ERROR_MESSAGES = {
  invalid_valid_from: 'Bitte gib ein gültiges Datum an.',
  invalid_day_minutes: 'Bitte gib für jeden Wochentag eine Stundenzahl zwischen 0 und 24 an.',
  duplicate_valid_from:
    'Für dieses Datum existiert bereits ein Wochenplan. Bearbeite die bestehende Version.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
  schedule_not_found: 'Der Wochenplan wurde nicht gefunden.',
} satisfies Record<string, string>;

/** The German sentence for a schedule action error code, or the fallback. */
export function getScheduleErrorMessage(code: string, fallback: string): string {
  return describeFailure(code, SCHEDULE_ERROR_MESSAGES, fallback);
}
