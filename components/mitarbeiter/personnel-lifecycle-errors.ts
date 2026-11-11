import { describeFailure } from '@/lib/action-messages';

/** Lifecycle-owned failure sentences; shared codes come from `describeFailure`. */
export const ERROR_MESSAGES = {
  stale_version: 'Der Stand hat sich geändert. Die Ansicht wird aktualisiert.',
  transition_not_allowed:
    'Dieser Übergang passt nicht mehr zum aktuellen Stand. Die Ansicht wird aktualisiert, wähle dann erneut.',
  membership_required: 'Vor der Aktivierung muss ein eingelöster Zugang bestehen.',
  last_admin_protected: 'Der letzte aktive Admin kann nicht gesperrt werden.',
  organization_owner_protected:
    'Der Organisationsinhaber kann hier nicht gesperrt oder inaktiv gesetzt werden.',
  last_responsibility_holder: 'Mindestens eine Verantwortung hätte danach keine wirksame Vertretung.',
  invalid_handover_date: 'Das Übergabedatum darf nicht vor heute liegen.',
  target_not_found: 'Die gewählte Person gehört nicht zu dieser Organisation.',
  invalid_target: 'Die Person kann ihre Arbeit nicht an sich selbst übergeben.',
  target_not_available: 'Die gewählte Person ist zum Übergabedatum schon ausgetreten.',
  target_without_login:
    'Ein Auftrag ohne Einsatz ab dem Übergabedatum braucht eine Person mit App-Zugang. Wähle jemand anderen.',
  stale_handover: 'Ein Auftrag ist nicht mehr bei dieser Person. Die Ansicht wird aktualisiert.',
  stale_planning_occurrence:
    'Ein Einsatz wurde inzwischen geändert. Bitte prüfe die Auswahl und übergib erneut.',
  job_not_found: 'Ein Auftrag ist nicht mehr offen. Die Ansicht wird aktualisiert.',
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

export function personnelLifecycleErrorMessage(code: string): string {
  return describeFailure(code, ERROR_MESSAGES, 'Die Aktion ist fehlgeschlagen. Bitte versuche es erneut.');
}
