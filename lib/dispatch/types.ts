import type { Database, Json } from '@/lib/supabase/database.types';

export const DISPATCH_OVERVIEW_MAX_OFFSET_DAYS = 14;

export type DispatchStatus = Database['public']['Enums']['dispatch_status'];
export type DispatchChangeKind =
  Database['public']['Enums']['dispatch_change_kind'];
export type DispatchAcknowledgementState =
  Database['public']['Enums']['dispatch_acknowledgement_state'];

// Derived per (current revision, recipient); never stored as a bare flag.
// 'nicht_moeglich' marks a recipient employee record without an active login —
// the office stays responsible for informing them; nothing is fabricated.
export type DispatchRecipientDerivedState =
  | 'ausstehend'
  | 'bestaetigt'
  | 'uebernommen'
  | 'rueckfrage'
  | 'nicht_moeglich';

export const DISPATCH_RECIPIENT_STATE_LABELS: Record<
  DispatchRecipientDerivedState,
  string
> = {
  ausstehend: 'Bestätigung ausstehend',
  bestaetigt: 'Bestätigt',
  uebernommen: 'Übernommen',
  rueckfrage: 'Rückfrage',
  nicht_moeglich: 'Ohne Zugang – Bestätigung nicht möglich',
};

export type DispatchRecipientView = {
  employeeRecordId: string;
  displayName: string;
  hasLogin: boolean;
  state: DispatchRecipientDerivedState;
  challengeReason: string | null;
  /** Latest acknowledgement row id (needed to resolve a challenge). */
  acknowledgementId: string | null;
};

export type DispatchView = {
  dispatchId: string;
  status: DispatchStatus;
  revisionId: string;
  revisionNumber: number;
  changeKind: DispatchChangeKind;
  targetKind: 'occurrence' | 'job';
  note: string | null;
  issuedAt: string;
  recipients: DispatchRecipientView[];
};

// One row of the manager "Einsätze" panel: a scheduled job visit in the
// window with its dispatch/commitment context, or an unscheduled job with an
// active job-targeted dispatch.
export type DispatchOverviewOccurrence = {
  occurrenceId: string;
  occurrenceVersion: number;
  seriesId: string | null;
  jobId: string;
  jobNumber: string | null;
  title: string;
  clientName: string | null;
  timeKind: Database['public']['Enums']['planning_time_kind'];
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  locationText: string | null;
  siteName: string | null;
  siteAccessNotes: string | null;
  assignedEmployeeRecordIds: string[];
  dispatch: DispatchView | null;
  commitment: DispatchCommitmentSummary | null;
  commitmentMismatch: boolean;
};

export type DispatchOverviewUnscheduledJob = {
  jobId: string;
  jobNumber: string | null;
  title: string;
  clientName: string | null;
  jobStatus: Database['public']['Enums']['job_status'];
  dispatch: DispatchView;
};

// Minimal commitment projection used on dispatch surfaces. The full record
// stays owned by lib/commitments.
export type DispatchCommitmentSummary = {
  commitmentId: string;
  committedDate: string;
  windowStartTime: string | null;
  windowEndTime: string | null;
  source: Database['public']['Enums']['customer_commitment_source'];
  contactName: string | null;
  recordedAt: string;
};

// Travel feasibility is computed only from explicit facts. Anything beyond
// same-site/no-gap knowledge is honestly "nicht bewertet" — never inferred
// from addresses (provider selection is P1-50).
export type TravelNote = {
  employeeRecordId: string;
  employeeName: string;
  localDate: string;
  kind: 'no_gap_different_sites' | 'gap_unassessed';
  gapMinutes: number;
  previousTitle: string;
  nextTitle: string;
};

export type ReadinessState = 'ok' | 'warning' | 'unknown';

export type ReadinessDimensionKey =
  | 'capacity'
  | 'qualification'
  | 'site'
  | 'travel'
  | 'material'
  | 'tools';

export type ReadinessDimension = {
  key: ReadinessDimensionKey;
  state: ReadinessState;
  label: string;
  details: string[];
};

export type ReadinessResult = {
  dimensions: ReadinessDimension[];
  snapshot: Json;
};

export type DispatchOverview = {
  occurrences: DispatchOverviewOccurrence[];
  unscheduledJobs: DispatchOverviewUnscheduledJob[];
  travelNotes: TravelNote[];
  openChallengeCount: number;
};

// Employee-facing card on the job detail: only the person's own dispatch,
// with one primary confirmation action. Acknowledgement never implies
// attendance or recorded time.
export type EmployeeDispatchCard = {
  dispatchId: string;
  revisionNumber: number;
  targetKind: 'occurrence' | 'job';
  startAt: string | null;
  endAt: string | null;
  startDate: string | null;
  endDateExclusive: string | null;
  locationText: string | null;
  note: string | null;
  committedToCustomer: boolean;
  committedWindowText: string | null;
  myState: DispatchRecipientDerivedState;
  myOpenChallengeReason: string | null;
};

export const DISPATCH_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'Bitte erneut anmelden.',
  no_active_org: 'Keine aktive Organisation gefunden.',
  not_a_member: 'Kein Zugriff auf diese Organisation.',
  not_authorized: 'Keine Berechtigung für diese Aktion.',
  invalid_input: 'Die Eingaben sind unvollständig oder ungültig.',
  load_failed: 'Die Einsatzdaten konnten nicht geladen werden.',
  dispatch_not_found: 'Der Einsatz wurde nicht gefunden.',
  dispatch_not_active: 'Der Einsatz ist nicht mehr aktiv.',
  dispatch_occurrence_not_found: 'Der geplante Besuch wurde nicht gefunden.',
  dispatch_occurrence_not_scheduled:
    'Nur eingeplante Besuche können versendet werden.',
  dispatch_job_not_found: 'Der Auftrag wurde nicht gefunden.',
  dispatch_job_not_dispatchable:
    'Dieser Auftrag kann derzeit nicht versendet werden.',
  dispatch_job_has_scheduled_visits:
    'Der Auftrag hat eingeplante Besuche – bitte den Besuch versenden.',
  dispatch_requires_recipients:
    'Ein Einsatz benötigt mindestens eine zugewiesene Person.',
  dispatch_recipient_not_found:
    'Eine ausgewählte Person wurde nicht gefunden.',
  dispatch_recipients_follow_assignments:
    'Bei eingeplanten Besuchen folgen die Empfänger der Besuchszuweisung.',
  stale_dispatch_revision:
    'Der Einsatz wurde zwischenzeitlich geändert. Bitte aktualisieren.',
  not_a_recipient: 'Dieser Einsatz ist nicht dir zugewiesen.',
  open_challenge_exists: 'Es gibt bereits eine offene Rückfrage.',
  challenge_reason_invalid:
    'Bitte eine Begründung mit 8 bis 500 Zeichen angeben.',
  resolution_reason_invalid:
    'Bitte eine Begründung mit 3 bis 1000 Zeichen angeben.',
  cancel_reason_invalid: 'Bitte eine Begründung mit 3 bis 1000 Zeichen angeben.',
  challenge_not_found: 'Die Rückfrage wurde nicht gefunden.',
  batch_reason_invalid:
    'Bitte eine Begründung mit 8 bis 1000 Zeichen angeben.',
  batch_selection_invalid:
    'Bitte 1 bis 100 zukünftige Besuche auswählen.',
  batch_item_stale:
    'Ein ausgewählter Besuch wurde zwischenzeitlich geändert. Bitte neu prüfen.',
  batch_item_not_found: 'Ein ausgewählter Besuch wurde nicht gefunden.',
  batch_item_not_scheduled:
    'Ein ausgewählter Besuch ist nicht mehr eingeplant.',
  batch_item_started:
    'Ein ausgewählter Besuch liegt nicht mehr in der Zukunft.',
  batch_item_invalid: 'Ein ausgewählter Besuch kann so nicht verschoben werden.',
  batch_item_all_day_needs_day_shift:
    'Ganztägige Besuche benötigen eine Verschiebung um mindestens einen Tag.',
  planning_warning: 'Es liegen Planungshinweise vor.',
  stale_assessment:
    'Die Planungslage hat sich geändert. Bitte die Hinweise erneut prüfen.',
  update_failed: 'Die Änderung konnte nicht gespeichert werden.',
  create_failed: 'Der Einsatz konnte nicht erstellt werden.',
  unexpected_error: 'Ein unerwarteter Fehler ist aufgetreten.',
};

export function dispatchErrorMessage(error: string): string {
  const known = DISPATCH_ERROR_MESSAGES[error];
  if (known) return known;
  const batchPrefix = Object.keys(DISPATCH_ERROR_MESSAGES).find(
    (key) => key.startsWith('batch_item_') && error.startsWith(key)
  );
  return batchPrefix
    ? DISPATCH_ERROR_MESSAGES[batchPrefix]
    : DISPATCH_ERROR_MESSAGES.unexpected_error;
}
