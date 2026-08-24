import type { Database, Json } from '@/lib/supabase/database.types';

export type WorkArtifactKind = Database['public']['Enums']['work_artifact_kind'];
export type WorkArtifactStatus = Database['public']['Enums']['work_artifact_status'];
export type WorkArtifactVisibility = Database['public']['Enums']['work_artifact_visibility'];
export type WorkArtifactActionType = Database['public']['Enums']['work_artifact_action_type'];
export type WorkArtifactMeasurementUnit = Database['public']['Enums']['work_artifact_measurement_unit'];
export type WorkArtifactDocumentRelation = Database['public']['Enums']['work_artifact_document_relation'];
export type WorkArtifactRow = Database['public']['Tables']['work_artifacts']['Row'];
export type WorkArtifactRevisionRow = Database['public']['Tables']['work_artifact_revisions']['Row'];
export type WorkArtifactActionRow = Database['public']['Tables']['work_artifact_actions']['Row'];
export type WorkArtifactMeasurementLineRow = Database['public']['Tables']['work_artifact_measurement_lines']['Row'];
export type WorkArtifactDefectDetailRow = Database['public']['Tables']['work_artifact_defect_details']['Row'];
export type WorkArtifactChangeDetailRow = Database['public']['Tables']['work_artifact_change_details']['Row'];
export type WorkArtifactDocumentRow = Database['public']['Tables']['work_artifact_revision_documents']['Row'];
export type WorkArtifactSourceRow = Database['public']['Tables']['work_artifact_revision_sources']['Row'];

export type WorkArtifactSummary = WorkArtifactRow & {
  currentRevision: WorkArtifactRevisionRow;
};

export type WorkArtifactDetail = WorkArtifactRow & {
  revisions: WorkArtifactRevisionRow[];
  actions: WorkArtifactActionRow[];
  measurementLines: WorkArtifactMeasurementLineRow[];
  defectDetails: WorkArtifactDefectDetailRow[];
  changeDetails: WorkArtifactChangeDetailRow[];
  documents: WorkArtifactDocumentRow[];
  sources: WorkArtifactSourceRow[];
};

export type MeasurementLineInput = {
  id?: string;
  description: string;
  location?: string;
  quantity: string;
  unit: WorkArtifactMeasurementUnit;
  note?: string;
};

export type WorkArtifactContentInput = {
  siteId?: string;
  instructionItemId?: string;
  summary?: string;
  customerStatement?: string;
  requiresCustomerResponse?: boolean;
  requiresSignature?: boolean;
  workDate?: string;
  progress?: string;
  peoplePresent?: string;
  weatherConditions?: string;
  siteConditions?: string;
  deliveries?: string;
  impediments?: string;
  decisions?: string;
  notableEvents?: string;
  visitStartedAt?: string;
  visitEndedAt?: string;
  performedWork?: string;
  outstandingWork?: string;
  materialsSummary?: string;
  nextVisitAt?: string;
  measurementDate?: string;
  measurementLocation?: string;
  measurementNotes?: string;
  measurementLines?: MeasurementLineInput[];
  defectDescription?: string;
  defectSeverity?: Database['public']['Enums']['work_artifact_defect_severity'];
  defectLocation?: string;
  responsibleEmployeeRecordId?: string;
  responsibilityContext?: string;
  dueDate?: string;
  defectState?: Database['public']['Enums']['work_artifact_defect_state'];
  proposedResolution?: string;
  resolutionSummary?: string;
  changeDescription?: string;
  changeReason?: string;
  requestedByContext?: string;
  expectedLaborMinutes?: string;
  actualLaborMinutes?: string;
  expectedMaterialSummary?: string;
  actualMaterialSummary?: string;
  authorizationState?: Database['public']['Enums']['work_artifact_change_authorization_state'];
  scheduleImpact?: string;
};

export type SaveWorkArtifactInput = {
  artifactId: string;
  revisionId: string;
  expectedVersion: number | null;
  targetType: 'job' | 'project';
  targetId: string;
  kind: WorkArtifactKind;
  visibility: WorkArtifactVisibility;
  capturedAt: string;
  title: string;
  content: WorkArtifactContentInput;
  correctsRevisionId?: string;
  correctionReason?: string;
  submit: boolean;
  submitActionId?: string;
};

export type WorkArtifactActionInput = {
  artifactId: string;
  revisionId: string;
  actionId: string;
  expectedVersion: number;
  actionType: WorkArtifactActionType;
  reason?: string;
  comment?: string;
  customerContext?: {
    signerName: string;
    signerRole?: string;
    signerRelationship: string;
    companyContext?: string;
    captureMethod: string;
    wordingSnapshot: string;
    witnessContext?: string;
  };
  signatureDocumentId?: string;
};

export type WorkArtifactMutationResult =
  | { success: true; artifactId: string; version: number; status: WorkArtifactStatus; data?: Json }
  | { success: false; error: string };

export const WORK_ARTIFACT_KINDS = [
  'site_diary', 'work_report', 'measurement', 'defect', 'change_work',
] as const satisfies readonly WorkArtifactKind[];

export const WORK_ARTIFACT_STATUSES = [
  'draft', 'submitted', 'approved', 'rejected', 'correction_requested', 'voided',
] as const satisfies readonly WorkArtifactStatus[];

export const WORK_ARTIFACT_KIND_LABELS: Record<WorkArtifactKind, string> = {
  site_diary: 'Bautagebuch',
  work_report: 'Arbeitsbericht',
  measurement: 'Aufmaß',
  defect: 'Mangel',
  change_work: 'Regie-/Änderungsnachweis',
};

export const WORK_ARTIFACT_STATUS_LABELS: Record<WorkArtifactStatus, string> = {
  draft: 'Entwurf', submitted: 'Zur Prüfung', approved: 'Intern freigegeben',
  rejected: 'Abgelehnt', correction_requested: 'Korrektur angefordert', voided: 'Ungültig',
};

export const WORK_ARTIFACT_UNIT_LABELS: Record<WorkArtifactMeasurementUnit, string> = {
  piece: 'Stk.', meter: 'm', square_meter: 'm²', cubic_meter: 'm³',
  liter: 'l', kilogram: 'kg', hour: 'Std.', flat_rate: 'Pauschale',
};

export const WORK_ARTIFACT_LEGAL_NOTICE =
  'Die erfasste Bestätigung oder Unterschrift dokumentiert den Vorgang zu genau dieser Version. WerkFlow bestätigt damit keine besondere Rechtswirksamkeit und keine qualifizierte elektronische Signatur.';
