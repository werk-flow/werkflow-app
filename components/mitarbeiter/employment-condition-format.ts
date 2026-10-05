/** Condition-owned failure sentences; shared codes come from `describeFailure`. */
export const CONDITION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid_valid_from: 'Bitte gib ein gültiges Datum an.',
  invalid_employment_type: 'Bitte wähle eine Beschäftigungsart aus.',
  invalid_weekly_hours: 'Die Wochenstunden müssen zwischen 0 und 100 liegen.',
  invalid_vacation_days: 'Die Urlaubstage müssen zwischen 0 und 100 liegen.',
  duplicate_valid_from:
    'Für dieses Datum existiert bereits eine Kondition. Bearbeite die bestehende Version.',
  record_not_found: 'Die Personalakte wurde nicht gefunden.',
  condition_not_found: 'Die Kondition wurde nicht gefunden.',
};
