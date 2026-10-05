import { describeFailure } from '@/lib/action-messages';

/** Lifecycle-owned failure sentences; shared codes come from `describeFailure`. */
export const ERROR_MESSAGES = {
  stale_version: 'Der Stand hat sich geändert. Die Ansicht wird aktualisiert.',
  membership_required: 'Vor der Aktivierung muss ein eingelöster Zugang bestehen.',
  last_admin_protected: 'Der letzte aktive Admin kann nicht gesperrt werden.',
  organization_owner_protected:
    'Der Organisationsinhaber kann hier nicht gesperrt oder inaktiv gesetzt werden.',
  last_responsibility_holder: 'Mindestens eine Verantwortung hätte danach keine wirksame Vertretung.',
  unresolved_work: 'Offene Zuständigkeiten oder Aufträge müssen zuerst geprüft werden.',
  future_effective_at_required: 'Wähle für eine Planung einen Zeitpunkt in der Zukunft.',
  immediate_effective_at_required:
    'Für diese Aktion gilt der aktuelle Zeitpunkt. Wähle für eine spätere Sperre den geplanten Übergang.',
  future_effective_date_required: 'Wähle für eine Planung ein Datum in der Zukunft.',
  no_scheduled_transition: 'Es gibt keinen geplanten Übergang, der zurückgenommen werden kann.',
  access_requirements_incomplete:
    'Mindestens eine ausdrücklich zugangsblockierende Anforderung ist noch offen.',
  requirement_not_open: 'Diese Anforderung ist nicht mehr offen und kann nicht bestätigt werden.',
  file_missing: 'Die Datei konnte nach dem Hochladen nicht bestätigt werden.',
  mutation_failed: 'Die Änderung konnte nicht gespeichert werden.',
} satisfies Record<string, string>;

export function errorMessage(code: string): string {
  return describeFailure(code, ERROR_MESSAGES, 'Die Aktion ist fehlgeschlagen. Bitte versuche es erneut.');
}

/** Field errors are keyed by control id; the first key wins focus. */
export function focusFirstInvalid(errors: Record<string, string>): boolean {
  const firstInvalidId = Object.keys(errors)[0];
  if (!firstInvalidId) return false;
  document.getElementById(firstInvalidId)?.focus();
  return true;
}
