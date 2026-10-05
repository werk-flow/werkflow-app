import { describeFailure } from '@/lib/action-messages';
import {
  completeMaintenanceDueWork,
  createMaintenanceVisit,
  linkMaintenanceServiceCase,
  scheduleMaintenanceVisit,
  setMaintenanceDueException,
} from '@/lib/maintenance/actions';
import type {
  MaintenanceActionResult,
  MaintenanceDueItem,
  MaintenanceScopeOutcome,
} from '@/lib/maintenance/types';
import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';

export type MaintenanceDueActionKind =
  | 'create_visit'
  | 'schedule'
  | 'complete'
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
};

export type MaintenanceDueRequiredField =
  | 'date'
  | 'durationHours'
  | 'completedOn'
  | 'evidenceIds'
  | 'serviceCaseId'
  | 'reason';

// Focus order on a failed submit.
export const MAINTENANCE_DUE_REQUIRED_FIELD_IDS: Array<[MaintenanceDueRequiredField, string]> = [
  ['date', 'due-date'],
  ['durationHours', 'due-duration'],
  ['completedOn', 'due-completed'],
  ['serviceCaseId', 'maintenance-service-case'],
  ['reason', 'due-reason'],
  ['evidenceIds', 'due-evidence'],
];

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
  if (reasonRequired && reason.trim().length < 3) {
    errors.reason = 'Bitte gib eine Begründung mit mindestens 3 Zeichen an.';
  }
  return errors;
}

const DUE_ACTION_ERROR_MESSAGES: Record<string, string> = {
  maintenance_stale_version: 'Die Fälligkeit wurde inzwischen geändert. Bitte lade die Seite neu.',
  maintenance_due_evidence_required: 'Wähle mindestens einen versionierten Arbeitsnachweis.',
  maintenance_due_evidence_mismatch: 'Ein gewählter Nachweis gehört nicht zu diesem Auftrag.',
  maintenance_completion_date_invalid:
    'Das Abschlussdatum muss im Wartungsfenster liegen und darf nicht in der Zukunft liegen.',
  maintenance_due_batch_incompatible:
    'Diese Fälligkeiten können nicht in einem Auftrag zusammengeführt werden.',
};

export function dueActionErrorMessage(code: string): string {
  return describeFailure(
    code,
    DUE_ACTION_ERROR_MESSAGES,
    'Die Wartungsaktion konnte nicht gespeichert werden.',
  );
}

/** Sends the server action that belongs to the chosen action kind. */
export async function runMaintenanceDueAction(
  due: MaintenanceDueItem,
  values: MaintenanceDueActionValues,
  idempotencyKey: string,
): Promise<MaintenanceActionResult> {
  const { action, reason } = values;
  if (action === 'create_visit') {
    return createMaintenanceVisit({
      dueWorkIds: [due.id],
      expectedVersions: [due.version],
      reason: reason || 'Wartungsauftrag angelegt',
      idempotencyKey,
    });
  }
  if (action === 'schedule' && due.jobId) {
    return scheduleMaintenanceVisit({
      dueWorkId: due.id,
      expectedVersion: due.version,
      jobId: due.jobId,
      startsAtLocal: `${values.date}T${values.time}`,
      durationMinutes: parseHoursInputToMinutes(values.durationHours) ?? 0,
      idempotencyKey,
    });
  }
  if (action === 'complete') {
    return completeMaintenanceDueWork({
      dueWorkId: due.id,
      expectedVersion: due.version,
      scopeOutcome: values.scopeOutcome,
      completedOn: values.completedOn,
      workArtifactRevisionIds: values.evidenceIds,
      reason: reason || 'Wartungsumfang dokumentiert',
      idempotencyKey,
    });
  }
  if (action === 'link_service_case') {
    return linkMaintenanceServiceCase({
      planId: due.planId,
      dueWorkId: due.id,
      expectedDueVersion: due.version,
      serviceCaseId: values.serviceCaseId,
      reason,
      idempotencyKey,
    });
  }
  if (['skipped', 'cancelled', 'superseded'].includes(action)) {
    return setMaintenanceDueException({
      dueWorkId: due.id,
      expectedVersion: due.version,
      toStatus: action,
      reason,
      idempotencyKey,
    });
  }
  return { success: false as const, error: 'invalid_input' };
}
