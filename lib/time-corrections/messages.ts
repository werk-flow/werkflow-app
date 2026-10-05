/**
 * One German sentence per failure code that `submitTimeCorrection` returns,
 * for every surface that submits a correction. Surfaces pass this map to
 * `describeFailure` (lib/action-messages.ts), which adds the shared codes
 * (`invalid_input`, `period_closed`, ...).
 */
export const TIME_CORRECTION_FAILURE_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  time_correction_timeline_changed:
    'Die Zeiten wurden während der Prüfung geändert. Bitte prüfe den Vorschlag und sende ihn erneut.',
  correction_timeline_conflict:
    'Die Änderung überschneidet sich mit einer anderen Buchung oder unterbricht eine bestehende Arbeitszeit. Bitte prüfe die Zeiten erneut.',
  correction_timeline_unavailable:
    'Die vorhandenen Zeiten konnten nicht vollständig geprüft werden. Bitte versuche es erneut.',
  invalid_shape: 'Die gewählte Korrektur ist unvollständig.',
  activity_context_required:
    'Diese Änderung benötigt weitere Tätigkeitsangaben. Bitte korrigiere die Buchung mit ihrer vollständigen Tätigkeit.',
  invalid_time_order: 'Die Endzeit muss nach der Startzeit liegen.',
  future_timestamp: 'Erfasste Arbeitszeit darf nicht in der Zukunft liegen.',
  source_required: 'Für diese Korrektur fehlt der ursprüngliche Eintrag.',
  source_not_found: 'Der ursprüngliche Eintrag hat sich geändert. Bitte lade neu.',
  time_correction_stale_source: 'Der ursprüngliche Eintrag hat sich geändert. Bitte lade neu.',
  calendar_incomplete_source:
    'Wähle die ganze Arbeitszeit von Beginn bis Ende aus. Eine laufende Buchung musst du vorher beenden.',
  time_correction_multiple_application_sources:
    'Bereits korrigierte Zeiten kannst du nur einzeln korrigieren.',
  not_responsible: 'Du darfst die Zeit dieser Person nicht direkt korrigieren.',
  time_correction_not_responsible: 'Du hast für diese Person keine Freigabeberechtigung.',
  self_approval_not_allowed: 'Eigene Korrekturen müssen von einer zweiten Person freigegeben werden.',
  time_correction_self_approval_forbidden:
    'Diese Zuordnung betrifft deine eigene Zeit und benötigt eine andere freigabeberechtigte Person.',
  request_failed: 'Die Korrektur konnte nicht gespeichert werden.',
};
