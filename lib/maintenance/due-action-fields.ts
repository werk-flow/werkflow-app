import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';

import type { MaintenanceMissedVisitReason, MaintenanceScopeOutcome } from './types';

// The due action dialog's field rules: which fields an action needs, so the
// user sees the missing field instead of the server's invalid_input.

export type MaintenanceDueActionKind =
  | 'create_visit'
  | 'schedule'
  | 'complete'
  | 'visit_missed'
  | 'link_service_case'
  | 'skipped'
  | 'cancelled'
  | 'superseded';

/** What the dialog has collected for the chosen action. */
export type MaintenanceDueActionValues = {
  action: MaintenanceDueActionKind;
  reason: string;
  date: string;
  time: string;
  durationHours: string;
  scopeOutcome: MaintenanceScopeOutcome;
  completedOn: string;
  evidenceIds: string[];
  serviceCaseId: string;
  missedReason: MaintenanceMissedVisitReason;
};

export type MaintenanceDueRequiredField =
  | 'date'
  | 'durationHours'
  | 'completedOn'
  | 'evidenceIds'
  | 'serviceCaseId'
  | 'reason';

// Focus order on a failed submit.
const MAINTENANCE_DUE_REQUIRED_FIELD_IDS: Array<[MaintenanceDueRequiredField, string]> = [
  ['date', 'due-date'],
  ['durationHours', 'due-duration'],
  ['completedOn', 'due-completed'],
  ['serviceCaseId', 'maintenance-service-case'],
  ['reason', 'due-reason'],
  ['evidenceIds', 'due-evidence'],
];

/** The missing fields by control id, in focus order. */
export function dueActionErrorsById(
  missing: Partial<Record<MaintenanceDueRequiredField, string>>,
): Record<string, string | undefined> {
  return Object.fromEntries(MAINTENANCE_DUE_REQUIRED_FIELD_IDS.map(([key, id]) => [id, missing[key]]));
}

// Mirrors the maintenance validation schemas per action so the user sees the
// missing field instead of the generic invalid_input message.
export function missingDueActionFields(
  values: MaintenanceDueActionValues,
  reasonRequired: boolean,
): Partial<Record<MaintenanceDueRequiredField, string>> {
  const { action, reason, date, durationHours, completedOn, evidenceIds, serviceCaseId } = values;
  const errors: Partial<Record<MaintenanceDueRequiredField, string>> = {};
  if (action === 'schedule') {
    if (!date) errors.date = 'Bitte wähle ein Datum.';
    if ((parseHoursInputToMinutes(durationHours) ?? 0) < 15) {
      errors.durationHours = 'Bitte gib mindestens 0,25 Stunden an.';
    }
  }
  if (action === 'complete') {
    if (!completedOn) errors.completedOn = 'Bitte gib das Abschlussdatum an.';
    if (evidenceIds.length === 0) {
      errors.evidenceIds = 'Wähle mindestens einen versionierten Arbeitsnachweis.';
    }
  }
  if (action === 'link_service_case' && !serviceCaseId) {
    errors.serviceCaseId = 'Bitte wähle einen Servicefall.';
  }
  // A filled optional note must meet the server's three characters; scheduling hides and sends no note.
  if ((reasonRequired || (action !== 'schedule' && reason.trim())) && reason.trim().length < 3) {
    errors.reason = 'Bitte gib eine Begründung mit mindestens 3 Zeichen an.';
  }
  return errors;
}

/** Whether the reason field must be filled for the chosen action. */
export function dueActionReasonRequired(
  values: Pick<MaintenanceDueActionValues, 'action' | 'missedReason'>,
): boolean {
  if (values.action === 'visit_missed') return values.missedReason === 'other';
  return !['schedule', 'create_visit', 'complete'].includes(values.action);
}
