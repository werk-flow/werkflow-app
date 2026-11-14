import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';

import type { MaintenanceMissedVisitReason, MaintenanceNextAction, MaintenanceScopeOutcome } from './types';

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
  /** The open Mängel of a partial or unresolved visit, one per line. */
  defectsText: string;
  /** Null until the user picks one. */
  nextAction: MaintenanceNextAction | null;
  nextActionOwnerId: string;
  nextActionTargetDate: string;
  nextActionNote: string;
};

export type MaintenanceDueRequiredField =
  | 'date'
  | 'durationHours'
  | 'completedOn'
  | 'evidenceIds'
  | 'serviceCaseId'
  | 'defects'
  | 'nextAction'
  | 'nextActionOwnerId'
  | 'nextActionTargetDate'
  | 'nextActionNote'
  | 'reason';

// Focus order on a failed submit.
const MAINTENANCE_DUE_REQUIRED_FIELD_IDS: Array<[MaintenanceDueRequiredField, string]> = [
  ['date', 'due-date'],
  ['durationHours', 'due-duration'],
  ['completedOn', 'due-completed'],
  ['defects', 'due-defects'],
  ['nextAction', 'due-next-action'],
  ['nextActionOwnerId', 'due-next-action-owner'],
  ['nextActionTargetDate', 'due-next-action-date'],
  ['nextActionNote', 'due-next-action-note'],
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
    if (values.scopeOutcome !== 'complete') Object.assign(errors, missingNextActionFields(values));
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

/** The Mängel of the defects field: one per non-empty line, trimmed. */
export function parseDefects(defectsText: string): string[] {
  return defectsText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// Mirrors maintenanceCompletionSchema for a partial or unresolved visit.
function missingNextActionFields(
  values: MaintenanceDueActionValues,
): Partial<Record<MaintenanceDueRequiredField, string>> {
  const { nextAction, nextActionOwnerId, nextActionTargetDate, nextActionNote, completedOn } = values;
  const errors: Partial<Record<MaintenanceDueRequiredField, string>> = {};
  const defects = parseDefects(values.defectsText);
  if (defects.length === 0) errors.defects = 'Bitte nenne mindestens einen offenen Mangel.';
  else if (defects.length > 10) errors.defects = 'Bitte nenne höchstens 10 Mängel.';
  else if (defects.some((defect) => defect.length < 3 || defect.length > 160)) {
    errors.defects = 'Jeder Mangel braucht 3 bis 160 Zeichen.';
  }
  if (!nextAction) errors.nextAction = 'Bitte wähle den nächsten Schritt.';
  if (nextAction === 'none' && nextActionNote.trim().length < 3) {
    errors.nextActionNote = 'Bitte begründe mit mindestens 3 Zeichen, warum nichts folgt.';
  } else if (nextAction === 'none' && nextActionNote.trim().length > 1000) {
    errors.nextActionNote = 'Bitte fasse die Begründung in höchstens 1.000 Zeichen.';
  }
  if (nextAction && nextAction !== 'none') {
    if (!nextActionOwnerId) errors.nextActionOwnerId = 'Bitte wähle, wer sich kümmert.';
    if (!nextActionTargetDate) errors.nextActionTargetDate = 'Bitte gib ein Zieldatum an.';
    else if (completedOn && nextActionTargetDate <= completedOn) {
      errors.nextActionTargetDate = 'Das Zieldatum muss nach dem Abschlussdatum liegen.';
    }
  }
  return errors;
}
