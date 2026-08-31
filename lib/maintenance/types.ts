import type { Database } from "@/lib/supabase/database.types";

export const MAINTENANCE_PLAN_STATUSES = [
  "draft",
  "active",
  "suspended",
  "terminated",
] as const satisfies readonly Database["public"]["Enums"]["maintenance_plan_status"][];

export const MAINTENANCE_COVERAGE_STATUSES = [
  "active",
  "suspended",
  "terminated",
] as const satisfies readonly Database["public"]["Enums"]["maintenance_coverage_status"][];

export const MAINTENANCE_DUE_STATUSES = [
  "open",
  "visit_created",
  "completed",
  "skipped",
  "cancelled",
  "superseded",
] as const satisfies readonly Database["public"]["Enums"]["maintenance_due_status"][];

export const MAINTENANCE_SCOPE_OUTCOMES = [
  "complete",
  "partial",
  "unresolved",
] as const satisfies readonly Database["public"]["Enums"]["maintenance_scope_outcome"][];

export const MAINTENANCE_NEXT_DUE_BASES = [
  "planned_due_date",
  "actual_completion_date",
] as const satisfies readonly Database["public"]["Enums"]["maintenance_next_due_basis"][];

export type MaintenancePlanStatus =
  Database["public"]["Enums"]["maintenance_plan_status"];
export type MaintenanceCoverageStatus =
  Database["public"]["Enums"]["maintenance_coverage_status"];
export type MaintenanceDueStatus =
  Database["public"]["Enums"]["maintenance_due_status"];
export type MaintenanceScopeOutcome =
  Database["public"]["Enums"]["maintenance_scope_outcome"];
export type MaintenanceNextDueBasis =
  Database["public"]["Enums"]["maintenance_next_due_basis"];
export type MaintenanceRenewalSignal =
  | "unknown"
  | "scheduled"
  | "due_soon"
  | "overdue";

export const MAINTENANCE_PLAN_STATUS_LABELS: Record<
  MaintenancePlanStatus,
  string
> = {
  draft: "Entwurf",
  active: "Aktiv",
  suspended: "Pausiert",
  terminated: "Beendet",
};

export const MAINTENANCE_COVERAGE_STATUS_LABELS: Record<
  MaintenanceCoverageStatus,
  string
> = {
  active: "Aktiv",
  suspended: "Pausiert",
  terminated: "Beendet",
};

export const MAINTENANCE_DUE_STATUS_LABELS: Record<
  MaintenanceDueStatus,
  string
> = {
  open: "Offen",
  visit_created: "Auftrag angelegt",
  completed: "Abgeschlossen",
  skipped: "Übersprungen",
  cancelled: "Abgesagt",
  superseded: "Ersetzt",
};

export const MAINTENANCE_SCOPE_OUTCOME_LABELS: Record<
  MaintenanceScopeOutcome,
  string
> = {
  complete: "Umfang vollständig erledigt",
  partial: "Umfang teilweise erledigt",
  unresolved: "Umfang nicht geklärt",
};

export const MAINTENANCE_NEXT_DUE_BASIS_LABELS: Record<
  MaintenanceNextDueBasis,
  string
> = {
  planned_due_date: "Ab geplantem Fälligkeitsdatum",
  actual_completion_date: "Ab tatsächlichem Abschluss",
};

export const MAINTENANCE_RENEWAL_SIGNAL_LABELS: Record<
  MaintenanceRenewalSignal,
  string
> = {
  unknown: "Frist nicht festgelegt",
  scheduled: "Prüfung vorgemerkt",
  due_soon: "Prüfung bald fällig",
  overdue: "Prüfung überfällig",
};

export type MaintenanceEquipmentOption = {
  id: string;
  equipmentNumber: string;
  name: string;
};

export type MaintenanceClientOption = {
  id: string;
  name: string;
  sites: Array<{
    id: string;
    name: string;
    address: string;
    equipment: MaintenanceEquipmentOption[];
  }>;
};

export type MaintenanceTemplateOption = {
  versionId: string;
  name: string;
  versionNumber: number;
};

export type MaintenanceCoverageItem = {
  id: string;
  coverageNumber: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  reference: string | null;
  description: string | null;
  status: MaintenanceCoverageStatus;
  validFrom: string | null;
  validUntil: string | null;
  noticeDate: string | null;
  renewalDate: string | null;
  reviewDueDate: string | null;
  operationalNote: string | null;
  renewalSignal: MaintenanceRenewalSignal;
  version: number;
};

export type MaintenancePlanItem = {
  id: string;
  planNumber: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  maintenanceCoverageId: string | null;
  coverageNumber: string | null;
  status: MaintenancePlanStatus;
  version: number;
  archivedAt: string | null;
  generationThroughDate: string | null;
  revisionId: string;
  revisionNumber: number;
  templateVersionId: string;
  templateName: string;
  effectiveFromDate: string;
  firstDueDate: string;
  intervalMonths: number;
  dueWindowBeforeDays: number;
  dueWindowAfterDays: number;
  plannedDurationMinutes: number;
  nextDueBasis: MaintenanceNextDueBasis;
  operationalInstructions: string | null;
  overlapReason: string | null;
  equipment: MaintenanceEquipmentOption[];
  openDueCount: number;
  nextDueDate: string | null;
};

export type MaintenanceDueItem = {
  id: string;
  planId: string;
  planNumber: string;
  clientId: string;
  clientName: string;
  siteId: string;
  siteName: string;
  dueDate: string;
  windowStartDate: string;
  windowEndDate: string;
  status: MaintenanceDueStatus;
  jobId: string | null;
  jobNumber: string | null;
  planningOccurrenceId: string | null;
  scopeOutcome: MaintenanceScopeOutcome | null;
  completedOn: string | null;
  exceptionReason: string | null;
  version: number;
  equipment: MaintenanceEquipmentOption[];
};

export type MaintenanceJobOption = {
  id: string;
  jobNumber: string;
  title: string;
  clientId: string | null;
  siteId: string | null;
};

export type MaintenanceEvidenceOption = {
  revisionId: string;
  title: string;
  revisionNumber: number;
};

export type MaintenanceWorkspace = {
  plans: MaintenancePlanItem[];
  dueWork: MaintenanceDueItem[];
  coverages: MaintenanceCoverageItem[];
  clients: MaintenanceClientOption[];
  templates: MaintenanceTemplateOption[];
  jobs: MaintenanceJobOption[];
  currentActorId: string;
  followUpOwners: Array<{
    userId: string;
    name: string;
    role: "admin" | "buero";
  }>;
  serviceCases: Array<{
    id: string;
    caseNumber: string;
    summary: string;
    clientId: string;
    siteId: string;
  }>;
};

export type MaintenancePlanInput = {
  planId: string;
  revisionId: string;
  clientId: string;
  siteId: string;
  maintenanceCoverageId?: string | null;
  status: Extract<MaintenancePlanStatus, "draft" | "active">;
  templateVersionId: string;
  effectiveFromDate: string;
  firstDueDate: string;
  intervalMonths: number;
  dueWindowBeforeDays: number;
  dueWindowAfterDays: number;
  plannedDurationMinutes: number;
  nextDueBasis: MaintenanceNextDueBasis;
  operationalInstructions?: string | null;
  overlapReason?: string | null;
  reason: string;
  equipmentIds: string[];
  idempotencyKey: string;
};

export type MaintenanceCoverageInput = {
  coverageId: string;
  clientId: string;
  siteId: string;
  reference?: string | null;
  description?: string | null;
  status: MaintenanceCoverageStatus;
  validFrom?: string | null;
  validUntil?: string | null;
  noticeDate?: string | null;
  renewalDate?: string | null;
  reviewDueDate?: string | null;
  operationalNote?: string | null;
  idempotencyKey: string;
};

export type FieldMaintenanceContext = {
  planNumber: string;
  dueDate: string;
  windowStartDate: string;
  windowEndDate: string;
  templateName: string;
  templateVersionNumber: number;
  operationalInstructions: string | null;
  equipment: MaintenanceEquipmentOption[];
};

export type MaintenanceActionResult =
  | { success: true }
  | { success: false; error: string };

export type MaintenanceWorkspaceResult =
  | { success: true; workspace: MaintenanceWorkspace }
  | { success: false; error: string };
