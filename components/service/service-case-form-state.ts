import type {
  ServiceCaseChargeContext,
  ServiceCaseDetail,
  ServiceCaseStatus,
} from '@/lib/service-cases/types';

export type ServiceCaseFormState = {
  clientId: string;
  siteId: string;
  contactId: string;
  originalStatement: string;
  originalDetails: string;
  summary: string;
  urgency: 'niedrig' | 'normal' | 'hoch' | 'notfall';
  status: ServiceCaseStatus;
  chargeContext: ServiceCaseChargeContext;
  accessInstructions: string;
  triageNote: string;
  resolutionNote: string;
  jobId: string;
  equipmentIds: string[];
  reason: string;
};

export const EMPTY_SERVICE_CASE_FORM: ServiceCaseFormState = {
  clientId: '',
  siteId: '',
  contactId: '',
  originalStatement: '',
  originalDetails: '',
  summary: '',
  urgency: 'normal',
  status: 'new',
  chargeContext: 'unknown',
  accessInstructions: '',
  triageNote: '',
  resolutionNote: '',
  jobId: '',
  equipmentIds: [],
  reason: '',
};

export const GENERIC_SERVICE_CASE_ERROR = 'Der Servicefall konnte nicht gespeichert werden.';

export const SERVICE_CASE_ERRORS: Record<string, string> = {
  service_case_stale_version: 'Der Servicefall wurde inzwischen geändert. Bitte lade die Seite neu.',
  service_case_job_mismatch: 'Der Auftrag gehört nicht zu diesem Kunden und Einsatzort.',
  service_case_equipment_mismatch: 'Mindestens eine Anlage gehört nicht zu diesem Einsatzort.',
  service_case_duplicate_relation_required: 'Verknüpfe zuerst den ursprünglichen Servicefall als Duplikat.',
  service_case_request_mismatch: 'Die Anfrage passt nicht mehr zum zugeordneten Kunden oder Einsatzort.',
};

export type ServiceCaseRequiredField =
  | 'clientId'
  | 'siteId'
  | 'originalStatement'
  | 'summary'
  | 'resolutionNote'
  | 'reason';

// Focus order on a failed submit; the ids double as the spec selectors.
export const SERVICE_CASE_REQUIRED_FIELD_IDS: Array<[ServiceCaseRequiredField, string]> = [
  ['clientId', 'service-client'],
  ['siteId', 'service-site'],
  ['originalStatement', 'service-statement'],
  ['summary', 'service-summary'],
  ['resolutionNote', 'service-resolution'],
  ['reason', 'service-reason'],
];

// Mirrors the server schema (serviceCaseCreateSchema / serviceCaseUpdateSchema)
// so the user sees the missing field instead of a generic "Bitte prüfe".
export function missingFields(
  form: ServiceCaseFormState,
  isUpdate: boolean,
  terminal: boolean,
): Partial<Record<ServiceCaseRequiredField, string>> {
  const errors: Partial<Record<ServiceCaseRequiredField, string>> = {};
  if (!isUpdate) {
    if (!form.clientId) errors.clientId = 'Bitte wähle einen Kunden.';
    if (!form.siteId) errors.siteId = 'Bitte wähle einen Einsatzort.';
    if (form.originalStatement.trim().length < 2) {
      errors.originalStatement = 'Bitte erfasse die Kundenaussage.';
    }
  }
  if (form.summary.trim().length < 2) {
    errors.summary = 'Bitte gib eine Kurzbeschreibung ein.';
  }
  if (isUpdate && terminal && form.resolutionNote.trim().length < 3) {
    errors.resolutionNote = 'Für den Abschluss ist eine Begründung erforderlich.';
  }
  if (isUpdate && form.reason.trim().length < 3) {
    errors.reason = 'Bitte gib einen Grund mit mindestens 3 Zeichen an.';
  }
  return errors;
}

export function fromDetail(item: ServiceCaseDetail): ServiceCaseFormState {
  return {
    clientId: item.clientId,
    siteId: item.siteId,
    contactId: item.contactId ?? '',
    originalStatement: item.originalStatement,
    originalDetails: item.originalDetails ?? '',
    summary: item.summary,
    urgency: item.urgency,
    status: item.status,
    chargeContext: item.chargeContext,
    accessInstructions: item.accessInstructions ?? '',
    triageNote: item.triageNote ?? '',
    resolutionNote: item.resolutionNote ?? '',
    jobId: item.jobId ?? '',
    equipmentIds: item.equipment.map((equipment) => equipment.id),
    reason: '',
  };
}
