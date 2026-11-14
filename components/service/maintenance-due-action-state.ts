import { describeFailure } from '@/lib/action-messages';
import {
  completeMaintenanceDueWork,
  createMaintenanceVisit,
  linkMaintenanceServiceCase,
  recordMaintenanceVisitMissed,
  scheduleMaintenanceVisit,
  setMaintenanceDueException,
} from '@/lib/maintenance/actions';
import type { MaintenanceDueActionValues } from '@/lib/maintenance/due-action-fields';
import type { MaintenanceActionResult, MaintenanceDueItem } from '@/lib/maintenance/types';
import { parseHoursInputToMinutes } from '@/lib/jobs/planned-working';

const DUE_ACTION_ERROR_MESSAGES: Record<string, string> = {
  maintenance_stale_version: 'Die Fälligkeit wurde inzwischen geändert. Bitte lade die Seite neu.',
  maintenance_due_evidence_required: 'Wähle mindestens einen versionierten Arbeitsnachweis.',
  maintenance_due_evidence_mismatch: 'Ein gewählter Nachweis gehört nicht zu diesem Auftrag.',
  maintenance_completion_date_invalid:
    'Das Abschlussdatum muss im Wartungsfenster liegen und darf nicht in der Zukunft liegen.',
  maintenance_due_batch_incompatible:
    'Diese Fälligkeiten können nicht in einem Auftrag zusammengeführt werden.',
  maintenance_due_visit_missed_not_allowed:
    'Diese Fälligkeit hat keinen offenen Wartungsauftrag mehr. Bitte lade die Seite neu.',
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
  if (action === 'visit_missed') {
    return recordMaintenanceVisitMissed({
      dueWorkId: due.id,
      expectedVersion: due.version,
      missedReason: values.missedReason,
      note: reason,
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
