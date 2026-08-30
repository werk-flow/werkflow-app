import type { Database, Json } from "@/lib/supabase/database.types";

export const SERVICE_CASE_STATUSES = [
  "new",
  "clarification_needed",
  "visit_required",
  "follow_up_required",
  "resolved",
  "closed_without_visit",
  "duplicate",
] as const satisfies readonly Database["public"]["Enums"]["service_case_status"][];
export type ServiceCaseStatus =
  Database["public"]["Enums"]["service_case_status"];

export const SERVICE_CASE_CHARGE_CONTEXTS = [
  "unknown",
  "suspected_warranty",
  "suspected_contract",
  "suspected_goodwill",
  "suspected_rework",
  "expected_chargeable",
] as const satisfies readonly Database["public"]["Enums"]["service_case_charge_context"][];
export type ServiceCaseChargeContext =
  Database["public"]["Enums"]["service_case_charge_context"];

export const SERVICE_CASE_RELATION_TYPES = [
  "duplicate_of",
  "related",
  "continuation_of",
] as const satisfies readonly Database["public"]["Enums"]["service_case_relation_type"][];
export type ServiceCaseRelationType =
  Database["public"]["Enums"]["service_case_relation_type"];

export const SERVICE_CASE_URGENCIES = [
  "niedrig",
  "normal",
  "hoch",
  "notfall",
] as const satisfies readonly Database["public"]["Enums"]["request_urgency"][];

export const SERVICE_CASE_STATUS_LABELS: Record<ServiceCaseStatus, string> = {
  new: "Neu",
  clarification_needed: "Klärung erforderlich",
  visit_required: "Einsatz erforderlich",
  follow_up_required: "Nacharbeit erforderlich",
  resolved: "Gelöst",
  closed_without_visit: "Ohne Einsatz geschlossen",
  duplicate: "Duplikat",
};

export const SERVICE_CASE_CHARGE_CONTEXT_LABELS: Record<
  ServiceCaseChargeContext,
  string
> = {
  unknown: "Noch ungeklärt",
  suspected_warranty: "Gewährleistung vermutet",
  suspected_contract: "Vertragsabdeckung vermutet",
  suspected_goodwill: "Kulanz vermutet",
  suspected_rework: "Nacharbeit vermutet",
  expected_chargeable: "Voraussichtlich berechenbar",
};

export const SERVICE_CASE_RELATION_LABELS: Record<
  ServiceCaseRelationType,
  string
> = {
  duplicate_of: "Duplikat von",
  related: "Zusammenhängend mit",
  continuation_of: "Fortsetzung von",
};

export const SERVICE_CASE_URGENCY_LABELS = {
  niedrig: "Niedrig",
  normal: "Normal",
  hoch: "Hoch",
  notfall: "Notfall",
} satisfies Record<Database["public"]["Enums"]["request_urgency"], string>;

export type ServiceCaseRow =
  Database["public"]["Tables"]["service_cases"]["Row"];
export type ServiceCaseEventRow =
  Database["public"]["Tables"]["service_case_events"]["Row"];

export type ServiceCaseEquipment = {
  id: string;
  equipmentNumber: string;
  name: string;
  manufacturer: string | null;
  model: string | null;
  locationDetail: string | null;
};

export type ServiceCaseListItem = {
  id: string;
  caseNumber: string;
  intakeType: Database["public"]["Enums"]["service_case_intake_type"];
  sourceRequestId: string | null;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  summary: string;
  urgency: Database["public"]["Enums"]["request_urgency"];
  status: ServiceCaseStatus;
  chargeContext: ServiceCaseChargeContext;
  jobId: string | null;
  jobNumber: string | null;
  jobTitle: string | null;
  equipment: ServiceCaseEquipment[];
  version: number;
  updatedAt: string;
};

export type ServiceCaseEvent = {
  id: string;
  eventType: Database["public"]["Enums"]["service_case_event_type"];
  actorName: string;
  reason: string | null;
  beforeSnapshot: Json | null;
  afterSnapshot: Json;
  recordedAt: string;
};

export type ServiceCaseRelation = {
  id: string;
  relationType: ServiceCaseRelationType;
  relatedCaseId: string;
  relatedCaseNumber: string;
  relatedSummary: string;
  reason: string;
  createdAt: string;
};

export type ServiceCaseEvidence = {
  id: string;
  revisionId: string;
  artifactId: string;
  revisionNumber: number;
  title: string;
  kind: Database["public"]["Enums"]["work_artifact_kind"];
  createdAt: string;
};

export type ServiceCaseEvidenceOption = {
  revisionId: string;
  artifactId: string;
  revisionNumber: number;
  title: string;
  kind: Database["public"]["Enums"]["work_artifact_kind"];
};

export type ServiceCaseDocument = {
  linkId: string;
  documentId: string;
  displayName: string;
  category: string;
  currentVersionNumber: number;
};

export type ServiceCaseDetail = ServiceCaseListItem & {
  contactId: string | null;
  contactName: string | null;
  originalStatement: string;
  originalDetails: string | null;
  accessInstructions: string | null;
  triageNote: string | null;
  resolutionNote: string | null;
  createdAt: string;
  events: ServiceCaseEvent[];
  relations: ServiceCaseRelation[];
  evidence: ServiceCaseEvidence[];
  documents: ServiceCaseDocument[];
};

export type ServiceCaseClientOption = {
  id: string;
  name: string;
  sites: Array<{
    id: string;
    name: string;
    address: string;
    isActive: boolean;
    equipment: ServiceCaseEquipment[];
  }>;
  contacts: Array<{ id: string; name: string }>;
};

export type ServiceCaseJobOption = {
  id: string;
  jobNumber: string | null;
  title: string;
  clientId: string | null;
  siteId: string | null;
};

export type ServiceCaseWorkspace = {
  cases: ServiceCaseListItem[];
  clients: ServiceCaseClientOption[];
};

export type ServiceCaseDetailWorkspace = {
  serviceCase: ServiceCaseDetail;
  currentActorId: string;
  clients: ServiceCaseClientOption[];
  jobs: ServiceCaseJobOption[];
  relatedCases: Array<{ id: string; caseNumber: string; summary: string }>;
  evidenceOptions: ServiceCaseEvidenceOption[];
  followUpOwners: Array<{
    userId: string;
    name: string;
    role: "admin" | "buero";
  }>;
};

export type ServiceCaseCreateInput = {
  serviceCaseId: string;
  idempotencyKey: string;
  sourceRequestId?: string | null;
  clientId?: string | null;
  contactId?: string | null;
  siteId?: string | null;
  originalStatement?: string | null;
  originalDetails?: string | null;
  summary?: string | null;
  urgency?: Database["public"]["Enums"]["request_urgency"];
  chargeContext: ServiceCaseChargeContext;
  accessInstructions?: string | null;
  triageNote?: string | null;
  equipmentIds: string[];
};

export type ServiceCaseUpdateInput = {
  serviceCaseId: string;
  expectedVersion: number;
  summary: string;
  urgency: Database["public"]["Enums"]["request_urgency"];
  status: ServiceCaseStatus;
  chargeContext: ServiceCaseChargeContext;
  accessInstructions?: string | null;
  triageNote?: string | null;
  resolutionNote?: string | null;
  jobId?: string | null;
  equipmentIds: string[];
  reason: string;
  idempotencyKey: string;
};

export type ServiceCaseRelationInput = {
  serviceCaseId: string;
  relatedServiceCaseId: string;
  relationType: ServiceCaseRelationType;
  expectedVersion: number;
  reason: string;
  idempotencyKey: string;
};

export type ServiceCaseEvidenceInput = {
  serviceCaseId: string;
  workArtifactRevisionId: string;
  expectedVersion: number;
  idempotencyKey: string;
};

export type ServiceCaseMutationResult =
  | { success: true; serviceCase: ServiceCaseRow }
  | { success: false; error: string };

export type ServiceCaseListResult =
  | { success: true; workspace: ServiceCaseWorkspace }
  | { success: false; error: string };

export type ServiceCaseDetailResult =
  | { success: true; workspace: ServiceCaseDetailWorkspace }
  | { success: false; error: string };

export type FieldServiceContext = {
  caseNumber: string;
  summary: string;
  urgency: Database["public"]["Enums"]["request_urgency"];
  accessInstructions: string | null;
  equipment: ServiceCaseEquipment[];
};

export type FieldServiceContextResult =
  | { success: true; contexts: FieldServiceContext[] }
  | { success: false; error: string };
