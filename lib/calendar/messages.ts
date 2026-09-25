/**
 * The calendar's one message layer (P1-24a, criterion 27). Every result code
 * a calendar action can return, and every refusal the client decides before a
 * drop, maps to one German sentence that names the rule and the next step.
 *
 * Tier 1: `CALENDAR_MESSAGES` satisfies a Record over the whole union, so a
 * code added to the union without a sentence fails `tsc`. Tier 2:
 * `messages.test.ts` scans the calendar-reachable action modules for result
 * codes and fails on one the union does not carry, and scans the calendar
 * components for a rendered raw code.
 *
 * A sentence with whitespace is not a code: the time-tracking validators
 * return German sentences that already name the rule, and those pass through.
 */

/** Codes returned by the actions the calendar calls (scanned by the unit test). */
type CalendarActionErrorCode =
  | 'apply_failed'
  | 'assessment_failed'
  | 'assign_failed'
  | 'break_mode_automatic'
  | 'calendar_read_failed'
  | 'calendar_scope_changed'
  | 'calendar_transport_failed'
  | 'client_not_found'
  | 'clients_failed'
  | 'clock_out_incomplete'
  | 'create_failed'
  | 'delete_failed'
  | 'employee_not_found'
  | 'entries_not_found'
  | 'entry_not_found'
  | 'entry_not_pending'
  | 'fetch_failed'
  | 'generation_failed'
  | 'insert_failed'
  | 'instruction_item_stale_version'
  | 'instruction_predecessor_incomplete'
  | 'invalid_client'
  | 'invalid_input'
  | 'invalid_occurrence'
  | 'invalid_recurrence'
  | 'invalid_time_range'
  | 'job_not_found'
  | 'job_not_parked'
  | 'job_number_required'
  | 'job_number_taken'
  | 'jobs_failed'
  | 'load_failed'
  | 'member_not_found'
  | 'members_failed'
  | 'mixed_organizations'
  | 'no_active_org'
  | 'no_changes'
  | 'no_mutable_occurrences'
  | 'not_a_member'
  | 'not_authenticated'
  | 'not_authorized'
  | 'not_authorized_source'
  | 'not_authorized_target'
  | 'not_found'
  | 'organization_changed'
  | 'overlapping_session'
  | 'partial_update'
  | 'planning_history_exists'
  | 'planning_warning'
  | 'project_not_found'
  | 'projects_failed'
  | 'qualification_declined'
  | 'qualification_warning'
  | 'request_already_reviewed'
  | 'request_not_found'
  | 'request_not_pending'
  | 'responsible_not_manager'
  | 'restore_failed'
  | 'revert_failed'
  | 'rollback_failed'
  | 'series_not_found'
  | 'series_not_materialized'
  | 'stale_assessment'
  | 'stale_evaluation'
  | 'stale_occurrence'
  | 'stale_version'
  | 'started_occurrence'
  | 'target_not_a_member'
  | 'target_not_found'
  | 'team_load_failed'
  | 'title_or_description_required'
  | 'unexpected_error'
  | 'update_failed'
  | 'validation_failed'
  | 'work_action_failed'
  | 'work_blocker_invalid_input'
  | 'work_blocker_not_authorized'
  | 'work_blocker_stale_version'
  | 'work_dependency_approval_action_invalid'
  | 'work_dependency_approval_not_found'
  | 'work_dependency_approval_target_mismatch'
  | 'work_dependency_cycle'
  | 'work_dependency_not_authorized'
  | 'work_dependency_self'
  | 'work_dependency_stale_version'
  | 'work_options_load_failed'
  | 'work_transition_completion_blocked'
  | 'work_transition_handover_requires_override'
  | 'work_transition_not_allowed'
  | 'work_transition_not_authorized'
  | 'work_transition_reason_required'
  | 'work_transition_stale_version'
  | 'work_transition_start_blocked'
  | 'work_with_history_cannot_be_deleted'
  | 'working_in_other_org';

/** Refusals the client decides before a drop, with the same wording rules. */
type CalendarClientRefusalCode =
  | 'internal_not_parkable'
  | 'future_timestamp'
  | 'overlapping_time_block'
  | 'person_absent'
  | 'person_off_day'
  | 'person_not_employed'
  | 'target_already_assigned'
  | 'inactive_occurrence'
  | 'parked_without_context'
  | 'outside_day'
  | 'no_drop_target'
  | 'only_occurrences_park'
  | 'time_block_moves_in_day_view'
  | 'time_block_needs_person'
  | 'all_day_extends_on_board'
  | 'parkplatz_changed';

export type CalendarRefusalCode = CalendarActionErrorCode | CalendarClientRefusalCode;

/** Facts a sentence may name; every placeholder has a neutral fallback. */
export type CalendarRefusalContext = {
  /** Display name of the affected person. */
  name?: string | undefined;
  /** Berlin date formatted for people, for example „18.9.". */
  date?: string | undefined;
};

type Sentence = string | ((context: CalendarRefusalContext) => string);

const SESSION_GONE = 'Deine Anmeldung ist abgelaufen. Melde dich neu an und versuche es noch einmal.';
const NOT_ALLOWED = 'Dafür fehlt dir die Berechtigung. Nur Büro und Admin planen um; die eigenen Einträge eines Büro-Mitglieds ändert ein Admin.';
const GONE = 'Der Eintrag wurde inzwischen gelöscht oder verschoben. Aktualisiere die Ansicht und versuche es dann noch einmal.';
const CHANGED_MEANWHILE = 'Dieser Eintrag wurde gerade von jemand anderem geändert. Die Ansicht wird aktualisiert; versuche es dann noch einmal.';
const PAST_OR_STARTED = 'Begonnene oder vergangene Termine bleiben unverändert. Plane einen neuen Termin, wenn die Arbeit weitergeht.';
const PERSON_GONE = 'Diese Person ist nicht mehr Mitglied der Organisation. Wähle eine andere Person.';
const SHAPE = 'Diese Änderung ist so nicht möglich. Öffne den Eintrag und prüfe Datum, Uhrzeit und Dauer.';
const SAVE_FAILED = 'Die Änderung konnte nicht gespeichert werden. Prüfe die Verbindung und versuche es noch einmal; die Ansicht zeigt wieder den gespeicherten Stand.';
const READ_FAILED = 'Der Kalender konnte nicht geladen werden. Prüfe die Verbindung und lade die Ansicht neu.';
const JOB_WRITE = 'Der Auftrag konnte so nicht gespeichert werden. Öffne den Auftrag und prüfe Titel, Auftragsnummer und Kunde.';
const EXECUTION_STATE = 'Der Arbeitsstand des Auftrags lässt diese Änderung nicht zu. Prüfe den Arbeitsstand auf der Auftragsseite.';
const REQUEST_STATE = 'Der Änderungsantrag ist nicht mehr offen. Aktualisiere die Ansicht.';

const withName = (fallback: string) => (context: CalendarRefusalContext): string => context.name ?? fallback;
const withDate = (context: CalendarRefusalContext): string => context.date ?? 'diesem Tag';

const CALENDAR_MESSAGES = {
  // Session, membership, permissions
  not_authenticated: SESSION_GONE,
  no_active_org: SESSION_GONE,
  not_a_member: SESSION_GONE,
  organization_changed: 'Die Organisation wurde gewechselt. Die Änderung wurde verworfen.',
  calendar_scope_changed: 'Die Organisation wurde gewechselt. Die Änderung wurde verworfen.',
  working_in_other_org: 'Diese Person ist gerade in einer anderen Organisation eingestempelt. Die Zeit lässt sich erst danach ändern.',
  not_authorized: NOT_ALLOWED,
  not_authorized_source: NOT_ALLOWED,
  not_authorized_target: NOT_ALLOWED,
  work_blocker_not_authorized: NOT_ALLOWED,
  work_dependency_not_authorized: NOT_ALLOWED,
  work_transition_not_authorized: NOT_ALLOWED,
  // Vanished targets
  job_not_found: GONE,
  not_found: GONE,
  entry_not_found: GONE,
  entries_not_found: GONE,
  request_not_found: GONE,
  series_not_found: GONE,
  target_not_found: PERSON_GONE,
  target_not_a_member: PERSON_GONE,
  member_not_found: PERSON_GONE,
  employee_not_found: PERSON_GONE,
  project_not_found: 'Das Projekt wurde nicht gefunden. Öffne den Auftrag und prüfe die Projektzuordnung.',
  client_not_found: 'Der Kunde wurde nicht gefunden. Öffne den Auftrag und prüfe den Kunden.',
  invalid_client: 'Der Kunde passt nicht zum Projekt. Öffne den Auftrag und prüfe den Kunden.',
  // Changed meanwhile
  stale_occurrence: CHANGED_MEANWHILE,
  stale_version: CHANGED_MEANWHILE,
  stale_evaluation: CHANGED_MEANWHILE,
  stale_assessment: 'Die Planungslage hat sich geändert. Prüfe die Hinweise erneut und entscheide noch einmal.',
  work_blocker_stale_version: CHANGED_MEANWHILE,
  work_dependency_stale_version: CHANGED_MEANWHILE,
  work_transition_stale_version: CHANGED_MEANWHILE,
  instruction_item_stale_version: CHANGED_MEANWHILE,
  series_not_materialized: 'Die Serie ist noch nicht vollständig angelegt. Öffne den Termin und verlängere die Serie.',
  started_occurrence: PAST_OR_STARTED,
  no_mutable_occurrences: PAST_OR_STARTED,
  planning_history_exists: 'Der Auftrag hat eine Planungshistorie und kann nicht gelöscht werden. Setze ihn auf einen passenden Status.',
  // Shape of the change
  invalid_input: SHAPE,
  invalid_occurrence: SHAPE,
  invalid_recurrence: 'Die Wiederholung ist so nicht möglich. Öffne den Termin und prüfe die Serie.',
  validation_failed: SHAPE,
  invalid_time_range: 'Das Ende liegt vor dem Anfang. Ziehe den Block so, dass er nach dem Anfang endet.',
  overlapping_session: (context) => `${withName('Diese Person')(context)} hat in diesem Zeitraum bereits Arbeitszeit. Wähle eine freie Zeit oder eine andere Person.`,
  mixed_organizations: 'Diese Einträge gehören zu verschiedenen Organisationen und können nicht zusammen verschoben werden.',
  break_mode_automatic: 'Pausen werden in dieser Organisation automatisch berechnet und lassen sich nicht einzeln ändern.',
  clock_out_incomplete: 'Die Person ist noch eingestempelt. Beende zuerst die laufende Arbeitszeit.',
  entry_not_pending: REQUEST_STATE,
  request_not_pending: REQUEST_STATE,
  request_already_reviewed: REQUEST_STATE,
  title_or_description_required: JOB_WRITE,
  job_number_required: JOB_WRITE,
  job_number_taken: 'Diese Auftragsnummer ist bereits vergeben. Öffne den Auftrag und wähle eine andere.',
  job_not_parked: 'Nur geparkte Aufträge tragen einen Parkplatz-Kontext. Aktualisiere die Ansicht.',
  responsible_not_manager: 'Die verantwortliche Person muss ein aktives Büro- oder Admin-Mitglied sein. Wähle eine andere Person.',
  work_blocker_invalid_input: 'Der Parkplatz-Kontext ist unvollständig. Gib Grund, verantwortliche Person und Wiedervorlage an.',
  work_transition_reason_required: 'Diese Änderung braucht eine Begründung. Öffne den Auftrag und trage sie ein.',
  work_transition_not_allowed: EXECUTION_STATE,
  work_transition_start_blocked: EXECUTION_STATE,
  work_transition_completion_blocked: EXECUTION_STATE,
  work_transition_handover_requires_override: EXECUTION_STATE,
  work_dependency_cycle: 'Diese Abhängigkeit würde einen Kreis bilden. Prüfe die Voraussetzungen auf der Auftragsseite.',
  work_dependency_self: 'Ein Auftrag kann nicht von sich selbst abhängen.',
  work_dependency_approval_not_found: 'Die Freigabe wurde nicht gefunden. Prüfe die Voraussetzungen auf der Auftragsseite.',
  work_dependency_approval_action_invalid: 'Diese Freigabe passt nicht zu der Voraussetzung. Prüfe sie auf der Auftragsseite.',
  work_dependency_approval_target_mismatch: 'Diese Freigabe gehört zu einem anderen Auftrag.',
  instruction_predecessor_incomplete: 'Ein vorheriger Schritt der Checkliste ist noch offen. Erledige ihn zuerst.',
  work_with_history_cannot_be_deleted: 'Der Auftrag hat eine Arbeitshistorie und kann nicht gelöscht werden.',
  // Dialogs own these; nothing is rendered as text
  planning_warning: null,
  qualification_warning: null,
  qualification_declined: null,
  no_changes: null,
  // Partial and failed writes
  partial_update: 'Der Termin wurde gespeichert, die Zuweisung nicht. Öffne den Termin und weise die Personen erneut zu.',
  rollback_failed: 'Ein Teil der Änderung konnte nicht zurückgenommen werden. Öffne den Auftrag und prüfe Termin und Zuweisung.',
  assign_failed: 'Die Zuweisung konnte nicht gespeichert werden. Öffne den Termin und weise die Personen erneut zu.',
  update_failed: SAVE_FAILED,
  create_failed: SAVE_FAILED,
  delete_failed: SAVE_FAILED,
  insert_failed: SAVE_FAILED,
  apply_failed: SAVE_FAILED,
  restore_failed: SAVE_FAILED,
  revert_failed: SAVE_FAILED,
  work_action_failed: SAVE_FAILED,
  assessment_failed: 'Die Kapazitäts- und Qualifikationsprüfung konnte nicht ausgeführt werden. Versuche es noch einmal.',
  generation_failed: 'Die Auftragsnummer konnte nicht vergeben werden. Versuche es noch einmal.',
  unexpected_error: SAVE_FAILED,
  calendar_transport_failed: SAVE_FAILED,
  // Reads
  calendar_read_failed: READ_FAILED,
  load_failed: READ_FAILED,
  fetch_failed: READ_FAILED,
  jobs_failed: READ_FAILED,
  clients_failed: READ_FAILED,
  projects_failed: READ_FAILED,
  members_failed: READ_FAILED,
  team_load_failed: READ_FAILED,
  work_options_load_failed: READ_FAILED,
  // Client pre-checks
  internal_not_parkable: 'Interne Termine werden abgesagt oder verschoben, nicht geparkt.',
  future_timestamp: 'Arbeitszeit kann nicht in der Zukunft liegen. Plane die Arbeit als Termin statt als Ist-Zeit.',
  overlapping_time_block: (context) => `${context.name ?? 'Diese Person'} hat in diesem Zeitraum bereits Arbeitszeit. Wähle eine freie Zeit.`,
  person_absent: (context) => `${context.name ?? 'Diese Person'} ist am ${withDate(context)} abwesend. Wähle einen anderen Tag oder eine andere Person.`,
  person_off_day: (context) => `${context.name ?? 'Diese Person'} arbeitet am ${withDate(context)} laut Arbeitszeitmodell nicht. Wähle einen Arbeitstag oder bestätige die Ausnahme im Dialog.`,
  person_not_employed: (context) => `${context.name ?? 'Diese Person'} ist am ${withDate(context)} nicht beschäftigt. Wähle einen Tag innerhalb der Beschäftigung.`,
  target_already_assigned: (context) => `${context.name ?? 'Diese Person'} ist diesem Termin bereits zugewiesen.`,
  inactive_occurrence: 'Ausgelassene und abgesagte Termine bleiben, wo sie sind. Plane einen neuen Termin.',
  parked_without_context: 'Der Auftrag hat noch keinen Parkplatz-Kontext. Ergänze ihn im Parkplatz über „Kontext ergänzen“, dann lässt er sich einplanen.',
  outside_day: 'Der Termin würde über Mitternacht hinausgehen. Wähle eine frühere Uhrzeit oder kürze die Dauer.',
  no_drop_target: 'Hier kann nichts abgelegt werden. Lege die Karte auf einer Person und einem Tag ab.',
  only_occurrences_park: 'Nur Termine lassen sich parken.',
  time_block_moves_in_day_view: 'Ist-Zeiten werden in der Tagesansicht verschoben.',
  time_block_needs_person: 'Arbeitszeit braucht eine Person.',
  all_day_extends_on_board: (context) => `Ganztägige Termine werden auf der Plantafel verlängert (${withDate(context)}).`,
  parkplatz_changed: 'Der Parkplatz wurde inzwischen geändert. Bitte lade die Ansicht neu.',
} satisfies Record<CalendarRefusalCode, Sentence | null>;

export const CALENDAR_REFUSAL_CODES = Object.keys(CALENDAR_MESSAGES) as CalendarRefusalCode[];

export function isCalendarRefusalCode(value: string): value is CalendarRefusalCode {
  return Object.hasOwn(CALENDAR_MESSAGES, value);
}

/**
 * The sentence for a refusal, or null when the code is handled elsewhere
 * (a dialog, a silent no-op). A server-side German sentence passes through.
 * An unknown code never reaches the user: it falls back to the generic
 * save failure, and the unit test keeps unknown codes out of the map.
 */
export function calendarRefusalMessage(
  code: string,
  context: CalendarRefusalContext = {},
): string | null {
  if (isCalendarRefusalCode(code)) {
    const sentence = CALENDAR_MESSAGES[code];
    if (sentence === null) return null;
    return typeof sentence === 'function' ? sentence(context) : sentence;
  }
  if (/\s/.test(code)) return code;
  return SAVE_FAILED;
}

/** Undo names its cause: the same sentence behind one fixed lead-in. */
export function calendarUndoFailureMessage(code: string, context?: CalendarRefusalContext): string {
  const sentence = calendarRefusalMessage(code, context) ?? SAVE_FAILED;
  return `Rückgängig war nicht möglich: ${sentence}`;
}

/** Berlin date as people read it in a sentence („18.9."). */
export function formatRefusalDate(dateIso: string): string {
  const [, month, day] = dateIso.split('-');
  if (!month || !day) return dateIso;
  return `${Number(day)}.${Number(month)}.`;
}
