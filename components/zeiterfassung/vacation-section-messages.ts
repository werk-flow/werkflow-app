import { describeFailure } from '@/lib/action-messages';

export const REQUEST_ERROR_MESSAGES = {
  invalid_dates: 'Bitte gib gültige Daten an.',
  invalid_range: 'Das Enddatum darf nicht vor dem Startdatum liegen.',
  range_too_long: 'Ein Antrag kann höchstens ein Jahr umfassen. Bitte teile längere Zeiträume auf.',
  invalid_portion: 'Bitte wähle Ganztägig oder Halbtägig aus.',
  half_day_needs_single_day: 'Ein halber Urlaubstag gilt nur für einen einzelnen Tag.',
  overlap_conflict: 'Für diesen Zeitraum existiert bereits ein offener oder genehmigter Urlaubsantrag.',
  no_employee_record: 'Zu deinem Zugang wurde keine Personalakte gefunden. Bitte wende dich an dein Büro.',
  not_authenticated: 'Bitte melde dich erneut an.',
  not_a_member: 'Du gehörst dieser Organisation nicht mehr an.',
  request_not_pending: 'Der Antrag ist nicht mehr offen.',
  not_authorized: 'Du darfst diesen Antrag nicht ändern.',
  insert_failed: 'Der Antrag konnte nicht gespeichert werden.',
  unexpected_error: 'Der Antrag konnte nicht gespeichert werden.',
} satisfies Record<string, string>;
/** The area's sentence for a code, then the shared one (invalid_input, period_closed, ...), then the fallback. */
export function getVacationRequestErrorMessage(code: string, fallback: string): string {
  return describeFailure(code, REQUEST_ERROR_MESSAGES, fallback);
}
