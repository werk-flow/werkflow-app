import type {
  MaintenanceNextDueBasis,
  MaintenancePlanInput,
  MaintenancePlanItem,
} from '@/lib/maintenance/types';

export type MaintenancePlanFormState = {
  clientId: string;
  siteId: string;
  maintenanceCoverageId: string;
  status: 'draft' | 'active';
  templateVersionId: string;
  effectiveFromDate: string;
  firstDueDate: string;
  intervalMonths: string;
  dueWindowBeforeDays: string;
  dueWindowAfterDays: string;
  plannedDurationMinutes: string;
  nextDueBasis: MaintenanceNextDueBasis;
  operationalInstructions: string;
  overlapReason: string;
  reason: string;
  equipmentIds: string[];
};

export const EMPTY_MAINTENANCE_PLAN_FORM: MaintenancePlanFormState = {
  clientId: '',
  siteId: '',
  maintenanceCoverageId: '',
  status: 'active',
  templateVersionId: '',
  effectiveFromDate: '',
  firstDueDate: '',
  intervalMonths: '12',
  dueWindowBeforeDays: '14',
  dueWindowAfterDays: '14',
  plannedDurationMinutes: '120',
  nextDueBasis: 'planned_due_date',
  operationalInstructions: '',
  overlapReason: '',
  reason: 'Wartungsplan angelegt',
  equipmentIds: [],
};

export const GENERIC_MAINTENANCE_PLAN_ERROR = 'Der Wartungsplan konnte nicht gespeichert werden.';

export const MAINTENANCE_PLAN_ERROR_MESSAGES: Record<string, string> = {
  invalid_input: 'Bitte prüfe die Angaben und wähle mindestens eine Anlage.',
  maintenance_plan_equipment_mismatch:
    'Mindestens eine Anlage gehört nicht zu diesem Einsatzort oder ist nicht mehr verfügbar.',
  maintenance_plan_coverage_mismatch: 'Die gewählte Abdeckung gehört nicht zu diesem Kunden und Einsatzort.',
  maintenance_template_version_unavailable: 'Die gewählte Arbeitsvorlage ist nicht mehr veröffentlicht.',
  maintenance_overlap_reason_required:
    'Für Anlagen mit einem weiteren aktiven Wartungsplan ist eine Begründung erforderlich.',
  maintenance_stale_version: 'Der Wartungsplan wurde inzwischen geändert. Bitte lade die Seite neu.',
};

export type MaintenancePlanRequiredField =
  | 'clientId'
  | 'siteId'
  | 'templateVersionId'
  | 'effectiveFromDate'
  | 'firstDueDate'
  | 'equipmentIds'
  | 'reason';

// Focus order on a failed submit; the ids double as the spec selectors.
export const MAINTENANCE_PLAN_REQUIRED_FIELD_IDS: Array<[MaintenancePlanRequiredField, string]> = [
  ['clientId', 'maintenance-client'],
  ['siteId', 'maintenance-site'],
  ['templateVersionId', 'maintenance-template'],
  ['effectiveFromDate', 'maintenance-effective'],
  ['firstDueDate', 'maintenance-first-due'],
  ['equipmentIds', 'maintenance-equipment'],
  ['reason', 'maintenance-reason'],
];

// Mirrors maintenancePlanSchema so the user sees the missing field instead of
// the generic invalid_input message.
export function missingFields(
  form: MaintenancePlanFormState,
  isRevision: boolean,
): Partial<Record<MaintenancePlanRequiredField, string>> {
  const errors: Partial<Record<MaintenancePlanRequiredField, string>> = {};
  if (!form.clientId) errors.clientId = 'Bitte wähle einen Kunden.';
  if (!form.siteId) errors.siteId = 'Bitte wähle einen Einsatzort.';
  if (!form.templateVersionId) {
    errors.templateVersionId = 'Bitte wähle eine veröffentlichte Arbeitsvorlage.';
  }
  if (!form.effectiveFromDate) {
    errors.effectiveFromDate = 'Bitte gib an, ab wann der Plan gilt.';
  }
  if (!form.firstDueDate) {
    errors.firstDueDate = 'Bitte gib die erste Fälligkeit an.';
  }
  if (form.siteId && form.equipmentIds.length === 0) {
    errors.equipmentIds = 'Wähle mindestens eine Anlage für den Wartungsumfang.';
  }
  if (isRevision && form.reason.trim().length < 3) {
    errors.reason = 'Bitte gib einen Grund mit mindestens 3 Zeichen an.';
  }
  return errors;
}

export function formFromPlan(plan: MaintenancePlanItem): MaintenancePlanFormState {
  return {
    clientId: plan.clientId,
    siteId: plan.siteId,
    maintenanceCoverageId: plan.maintenanceCoverageId ?? '',
    status: plan.status === 'active' ? 'active' : 'draft',
    templateVersionId: plan.templateVersionId,
    effectiveFromDate: plan.effectiveFromDate,
    firstDueDate: plan.firstDueDate,
    intervalMonths: String(plan.intervalMonths),
    dueWindowBeforeDays: String(plan.dueWindowBeforeDays),
    dueWindowAfterDays: String(plan.dueWindowAfterDays),
    plannedDurationMinutes: String(plan.plannedDurationMinutes),
    nextDueBasis: plan.nextDueBasis,
    operationalInstructions: plan.operationalInstructions ?? '',
    overlapReason: plan.overlapReason ?? '',
    reason: 'Wartungsumfang angepasst',
    equipmentIds: plan.equipment.map((equipment) => equipment.id),
  };
}

/** The ids one dialog instance sends with every attempt, so a retry is idempotent. */
export type MaintenancePlanMutationIdentity = {
  planId: string;
  revisionId: string;
  idempotencyKey: string;
};

export function toMaintenancePlanInput(
  form: MaintenancePlanFormState,
  identity: MaintenancePlanMutationIdentity,
): MaintenancePlanInput {
  return {
    planId: identity.planId,
    revisionId: identity.revisionId,
    clientId: form.clientId,
    siteId: form.siteId,
    maintenanceCoverageId: form.maintenanceCoverageId || null,
    status: form.status,
    templateVersionId: form.templateVersionId,
    effectiveFromDate: form.effectiveFromDate,
    firstDueDate: form.firstDueDate,
    intervalMonths: Number(form.intervalMonths),
    dueWindowBeforeDays: Number(form.dueWindowBeforeDays),
    dueWindowAfterDays: Number(form.dueWindowAfterDays),
    plannedDurationMinutes: Number(form.plannedDurationMinutes),
    nextDueBasis: form.nextDueBasis,
    operationalInstructions: form.operationalInstructions || null,
    overlapReason: form.overlapReason || null,
    reason: form.reason,
    equipmentIds: form.equipmentIds,
    idempotencyKey: identity.idempotencyKey,
  };
}
