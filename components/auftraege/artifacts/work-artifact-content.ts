import type { WorkArtifactContentInput, WorkArtifactDetail } from '@/lib/work-artifacts/types';

export type WorkArtifactEvidenceRequirement = {
  id: string;
  description: string;
  documentCategory: string;
  fulfillment?: { id: string; version: number } | null;
};
export type WorkArtifactTarget = { targetType: 'job' | 'project'; targetId: string };

// Editor state: a patch may set a field to undefined to clear it; `compact` drops
// those before the input reaches the server action.
export type WorkArtifactContentDraft = {
  [Key in keyof WorkArtifactContentInput]: WorkArtifactContentInput[Key] | undefined;
};

// One German label per stored value, shared by the editor selects and the read view.
export const DEFECT_SEVERITY_LABELS: Record<
  NonNullable<WorkArtifactContentInput['defectSeverity']>,
  string
> = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch' };
export const DEFECT_STATE_LABELS: Record<NonNullable<WorkArtifactContentInput['defectState']>, string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  resolved: 'Behoben',
};
export const AUTHORIZATION_STATE_LABELS: Record<
  NonNullable<WorkArtifactContentInput['authorizationState']>,
  string
> = {
  not_requested: 'Nicht angefragt',
  requested: 'Angefragt',
  authorized: 'Autorisiert',
  rejected: 'Abgelehnt',
};

export const EMPTY_CONTENT: WorkArtifactContentInput = {
  summary: '',
  progress: '',
  performedWork: '',
  outstandingWork: '',
  materialsSummary: '',
  measurementLocation: '',
  measurementNotes: '',
  measurementLines: [],
  defectDescription: '',
  defectSeverity: 'medium',
  defectLocation: '',
  defectState: 'open',
  proposedResolution: '',
  resolutionSummary: '',
  changeDescription: '',
  changeReason: '',
  requestedByContext: '',
  authorizationState: 'not_requested',
  scheduleImpact: '',
};

export function localDateTime(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function iso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

export function compact<T extends Record<string, unknown>>(
  value: T,
): { [Key in keyof T]: Exclude<T[Key], undefined> } {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== '' && entry !== undefined),
  ) as { [Key in keyof T]: Exclude<T[Key], undefined> };
}

export function contentFromDetail(detail: WorkArtifactDetail): WorkArtifactContentInput {
  const revision = detail.revisions.find((entry) => entry.id === detail.current_revision_id);
  if (!revision) return { ...EMPTY_CONTENT };
  const defect = detail.defectDetails.find((entry) => entry.revision_id === revision.id);
  const change = detail.changeDetails.find((entry) => entry.revision_id === revision.id);
  return compact({
    siteId: revision.site_id ?? '',
    instructionItemId: revision.instruction_item_id ?? '',
    summary: revision.summary ?? '',
    customerStatement: revision.customer_statement ?? '',
    requiresCustomerResponse: revision.requires_customer_response,
    requiresSignature: revision.requires_signature,
    workDate: revision.work_date ?? '',
    progress: revision.progress ?? '',
    peoplePresent: revision.people_present ?? '',
    weatherConditions: revision.weather_conditions ?? '',
    siteConditions: revision.site_conditions ?? '',
    deliveries: revision.deliveries ?? '',
    impediments: revision.impediments ?? '',
    decisions: revision.decisions ?? '',
    notableEvents: revision.notable_events ?? '',
    visitStartedAt: localDateTime(revision.visit_started_at),
    visitEndedAt: localDateTime(revision.visit_ended_at),
    performedWork: revision.performed_work ?? '',
    outstandingWork: revision.outstanding_work ?? '',
    materialsSummary: revision.materials_summary ?? '',
    nextVisitAt: localDateTime(revision.next_visit_at),
    measurementDate: revision.measurement_date ?? '',
    measurementLocation: revision.measurement_location ?? '',
    measurementNotes: revision.measurement_notes ?? '',
    measurementLines: detail.measurementLines
      .filter((line) => line.revision_id === revision.id)
      .map((line) => ({
        id: line.id,
        description: line.description,
        location: line.location ?? '',
        quantity: String(line.quantity).replace('.', ','),
        unit: line.unit,
        note: line.note ?? '',
      })),
    defectDescription: defect?.description ?? '',
    defectSeverity: defect?.severity ?? 'medium',
    defectLocation: defect?.location ?? '',
    responsibleEmployeeRecordId: defect?.responsible_employee_record_id ?? '',
    responsibilityContext: defect?.responsibility_context ?? '',
    dueDate: defect?.due_date ?? '',
    defectState: defect?.state ?? 'open',
    proposedResolution: defect?.proposed_resolution ?? '',
    resolutionSummary: defect?.resolution_summary ?? '',
    changeDescription: change?.change_description ?? '',
    changeReason: change?.change_reason ?? '',
    requestedByContext: change?.requested_by_context ?? '',
    expectedLaborMinutes: change?.expected_labor_minutes == null ? '' : String(change.expected_labor_minutes),
    actualLaborMinutes: change?.actual_labor_minutes == null ? '' : String(change.actual_labor_minutes),
    expectedMaterialSummary: change?.expected_material_summary ?? '',
    actualMaterialSummary: change?.actual_material_summary ?? '',
    authorizationState: change?.authorization_state ?? 'not_requested',
    scheduleImpact: change?.schedule_impact ?? '',
  });
}
