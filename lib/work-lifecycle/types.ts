import type { Database, Json } from "@/lib/supabase/database.types";
import type { ReadinessResult } from "@/lib/dispatch/types";
import { WORK_ARTIFACT_KINDS, WORK_ARTIFACT_STATUSES } from "@/lib/work-artifacts/types";
import { z } from "zod";
import { uuidSchema } from "@/lib/validation/uuid";

export type WorkTargetType = "job" | "project";
export type WorkExecutionState =
  Database["public"]["Enums"]["work_execution_state"];
export type WorkBlockerReason =
  Database["public"]["Enums"]["work_blocker_reason"];
export type WorkDependencyEffect =
  Database["public"]["Enums"]["work_dependency_effect"];
export type WorkDeclaredDependencyKind =
  Database["public"]["Enums"]["work_declared_dependency_kind"];
export type WorkBlocker = Database["public"]["Tables"]["work_blockers"]["Row"];
export type WorkDependency =
  Database["public"]["Tables"]["work_dependencies"]["Row"] & {
    is_satisfied: boolean;
  };
export type WorkExecutionEvent =
  Database["public"]["Tables"]["work_execution_events"]["Row"];
export type WorkArtifactFact = {
  artifactId: string;
  version: number;
  revisionId: string;
  status: Database["public"]["Enums"]["work_artifact_status"];
  kind: Database["public"]["Enums"]["work_artifact_kind"];
  latestActionId: string | null;
  defectState: Database["public"]["Enums"]["work_artifact_defect_state"] | null;
};

export const WORK_EXECUTION_STATES = [
  "not_started",
  "in_progress",
  "interrupted",
  "execution_complete",
  "handed_over",
  "cancelled",
] as const satisfies readonly WorkExecutionState[];

const TERMINAL_WORK_EXECUTION_STATES: Record<WorkExecutionState, boolean> = {
  not_started: false,
  in_progress: false,
  interrupted: false,
  execution_complete: true,
  handed_over: true,
  cancelled: true,
};

export function isTerminalWorkExecutionState(state: WorkExecutionState): boolean {
  return TERMINAL_WORK_EXECUTION_STATES[state];
}
export const WORK_BLOCKER_REASONS = [
  "customer",
  "material",
  "approval",
  "capacity",
  "site_access",
  "dependency",
  "external_trade",
  "safety",
  "internal_clarification",
  "other",
] as const satisfies readonly WorkBlockerReason[];
export const WORK_DEPENDENCY_EFFECTS = [
  "blocks_start",
  "blocks_completion",
  "warning",
] as const satisfies readonly WorkDependencyEffect[];
export const WORK_DECLARED_DEPENDENCY_KINDS = [
  "approval",
  "delivery",
  "site_condition",
  "external_trade",
] as const satisfies readonly WorkDeclaredDependencyKind[];

export type WorkGateSnapshot = {
  incompleteRequiredInstructions: number;
  reopenedInstructionPredecessors: number;
  incompleteInstructionEvidence: number;
  openBlockers: number;
  openStartDependencies: number;
  openCompletionDependencies: number;
  activeJobClocks: number;
  incompleteProjectChildren: number;
  measurementArtifacts: number;
  openDefects: number;
  pendingFormalApprovals: number;
  requiredCustomerDecisions: number;
  requiredSignatures: number;
  artifactFacts: WorkArtifactFact[];
  notAssessable: string[];
};

export type WorkEntityOption = {
  value: string;
  label: string;
  description?: string;
};

export type WorkLifecycleSnapshot = {
  targetType: WorkTargetType;
  targetId: string;
  executionState: WorkExecutionState;
  executionVersion: number;
  isLegacy: boolean;
  isPlanned: boolean;
  gates: WorkGateSnapshot;
  blockers: WorkBlocker[];
  resolvedBlockers: WorkBlocker[];
  dependencies: WorkDependency[];
  history: WorkExecutionEvent[];
  readiness: ReadinessResult | null;
  readinessLoadFailed: boolean;
  ownOwnerId: string | null;
  ownerOptions: WorkEntityOption[];
  predecessorOptions: Record<
    "job" | "project" | "instruction" | "declared",
    WorkEntityOption[]
  >;
};

export const WORK_EXECUTION_LABELS: Record<WorkExecutionState, string> = {
  not_started: "Nicht begonnen",
  in_progress: "In Ausführung",
  interrupted: "Unterbrochen",
  execution_complete: "Ausführung abgeschlossen",
  handed_over: "Übergeben",
  cancelled: "Storniert",
};

export const WORK_BLOCKER_REASON_LABELS: Record<WorkBlockerReason, string> = {
  customer: "Kunde",
  material: "Material",
  approval: "Freigabe",
  capacity: "Kapazität",
  site_access: "Zugang zum Einsatzort",
  dependency: "Abhängigkeit",
  external_trade: "Fremdgewerk",
  safety: "Sicherheit",
  internal_clarification: "Interne Klärung",
  other: "Sonstiges",
};

export const WORK_DEPENDENCY_EFFECT_LABELS: Record<
  WorkDependencyEffect,
  string
> = {
  blocks_start: "Blockiert den Start",
  blocks_completion: "Blockiert den Abschluss",
  warning: "Nur Hinweis",
};

export const WORK_DECLARED_KIND_LABELS: Record<
  WorkDeclaredDependencyKind,
  string
> = {
  approval: "Freigabe",
  delivery: "Lieferung",
  site_condition: "Bedingung am Einsatzort",
  external_trade: "Fremdgewerk",
};

export const WORK_TRANSITIONS: Record<
  WorkExecutionState,
  WorkExecutionState[]
> = {
  not_started: ["in_progress", "cancelled"],
  in_progress: ["interrupted", "execution_complete", "cancelled"],
  interrupted: ["in_progress", "cancelled"],
  execution_complete: ["handed_over", "in_progress"],
  handed_over: ["execution_complete"],
  cancelled: ["not_started"],
};

export function getAllowedWorkTransitions(
  state: WorkExecutionState,
  isManager: boolean,
): WorkExecutionState[] {
  if (isManager) {
    if (state === "handed_over") return [];
    return WORK_TRANSITIONS[state].filter((next) => next !== "handed_over");
  }
  if (isTerminalWorkExecutionState(state)) return [];
  return WORK_TRANSITIONS[state].filter(
    (next) => next !== "cancelled" && next !== "handed_over",
  );
}

export function getWorkNextAction(
  snapshot: Pick<
    WorkLifecycleSnapshot,
    "executionState" | "blockers" | "dependencies"
  >,
): string {
  if (
    snapshot.blockers.some(
      (blocker) => blocker.state === "open" && blocker.kind === "parking",
    )
  ) {
    return "Parkgrund prüfen und Arbeit wieder einplanen";
  }
  if (
    snapshot.blockers.some(
      (blocker) => blocker.state === "open" && blocker.kind === "blocker",
    )
  ) {
    return "Offene Blocker klären";
  }
  if (
    snapshot.dependencies.some(
      (dependency) =>
        !dependency.is_satisfied && dependency.effect !== "warning",
    )
  ) {
    return "Voraussetzungen klären";
  }
  return {
    not_started: "Arbeit starten",
    in_progress: "Arbeit fortführen oder Ausführung abschließen",
    interrupted: "Arbeit fortsetzen",
    execution_complete: "Übergabe prüfen",
    handed_over: "Keine offene Aktion",
    cancelled: "Stornierung prüfen",
  }[snapshot.executionState];
}

type DatabaseWorkLifecycleSnapshot = Omit<
  WorkLifecycleSnapshot,
  | "ownerOptions"
  | "ownOwnerId"
  | "predecessorOptions"
  | "readiness"
  | "readinessLoadFailed"
  | "resolvedBlockers"
>;

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ]),
);
const nullableUuidSchema = uuidSchema.nullable();
const workExecutionStateSchema = z.enum(WORK_EXECUTION_STATES);
const workBlockerSchema: z.ZodType<WorkBlocker> = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  job_id: nullableUuidSchema,
  project_id: nullableUuidSchema,
  parent_project_parking_blocker_id: nullableUuidSchema,
  instruction_item_id: nullableUuidSchema,
  kind: z.enum(["blocker", "parking"]),
  reason: z.enum(WORK_BLOCKER_REASONS).nullable(),
  details: z.string().nullable(),
  responsible_employee_record_id: nullableUuidSchema,
  next_review_date: z.string().nullable(),
  state: z.enum(["open", "resolved"]),
  version: z.number().int().positive(),
  is_legacy: z.boolean(),
  legacy_source: z.string().nullable(),
  created_by: nullableUuidSchema,
  created_at: z.string(),
  updated_by: nullableUuidSchema,
  updated_at: z.string(),
  resolved_by: nullableUuidSchema,
  resolved_at: z.string().nullable(),
  resolution_note: z.string().nullable(),
});
const workDependencySchema: z.ZodType<WorkDependency> = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  dependent_job_id: nullableUuidSchema,
  dependent_project_id: nullableUuidSchema,
  predecessor_job_id: nullableUuidSchema,
  predecessor_project_id: nullableUuidSchema,
  predecessor_instruction_item_id: nullableUuidSchema,
  artifact_approval_action_id: nullableUuidSchema,
  declared_kind: z.enum(WORK_DECLARED_DEPENDENCY_KINDS).nullable(),
  description: z.string().nullable(),
  effect: z.enum(WORK_DEPENDENCY_EFFECTS),
  manual_state: z.enum(["open", "satisfied", "waived"]).nullable(),
  version: z.number().int().positive(),
  removed_at: z.string().nullable(),
  removed_by: nullableUuidSchema,
  created_by: nullableUuidSchema,
  created_at: z.string(),
  updated_by: nullableUuidSchema,
  updated_at: z.string(),
  is_satisfied: z.boolean(),
});
const workExecutionEventSchema: z.ZodType<WorkExecutionEvent> = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  job_id: nullableUuidSchema,
  project_id: nullableUuidSchema,
  event_type: z.string().min(1),
  from_state: workExecutionStateSchema.nullable(),
  to_state: workExecutionStateSchema.nullable(),
  previous_version: z.number().int().nonnegative(),
  resulting_version: z.number().int().positive(),
  reason: z.string().nullable(),
  gate_snapshot: jsonSchema,
  gate_fingerprint: z.string().length(64),
  event_payload: jsonSchema,
  created_by: nullableUuidSchema,
  created_at: z.string(),
});
const databaseWorkLifecycleSnapshotSchema: z.ZodType<DatabaseWorkLifecycleSnapshot> =
  z.object({
    targetType: z.enum(["job", "project"]),
    targetId: uuidSchema,
    executionState: workExecutionStateSchema,
    executionVersion: z.number().int().nonnegative(),
    isLegacy: z.boolean(),
    isPlanned: z.boolean(),
    gates: z.object({
      incompleteRequiredInstructions: z.number().int().nonnegative(),
      reopenedInstructionPredecessors: z.number().int().nonnegative(),
      incompleteInstructionEvidence: z.number().int().nonnegative(),
      openBlockers: z.number().int().nonnegative(),
      openStartDependencies: z.number().int().nonnegative(),
      openCompletionDependencies: z.number().int().nonnegative(),
      activeJobClocks: z.number().int().nonnegative(),
      incompleteProjectChildren: z.number().int().nonnegative(),
      measurementArtifacts: z.number().int().nonnegative(),
      openDefects: z.number().int().nonnegative(),
      pendingFormalApprovals: z.number().int().nonnegative(),
      requiredCustomerDecisions: z.number().int().nonnegative(),
      requiredSignatures: z.number().int().nonnegative(),
      artifactFacts: z.array(z.object({
        artifactId: uuidSchema,
        version: z.number().int().positive(),
        revisionId: uuidSchema,
        status: z.enum(WORK_ARTIFACT_STATUSES),
        kind: z.enum(WORK_ARTIFACT_KINDS),
        latestActionId: nullableUuidSchema,
        defectState: z.enum(["open", "in_progress", "resolved"]).nullable(),
      })),
      notAssessable: z.array(z.string()),
    }),
    blockers: z.array(workBlockerSchema),
    dependencies: z.array(workDependencySchema),
    history: z.array(workExecutionEventSchema),
  });

export function parseWorkLifecycleSnapshot(
  value: Json,
):
  | { success: true; snapshot: DatabaseWorkLifecycleSnapshot }
  | { success: false; error: "work_snapshot_invalid_response" } {
  const parsed = databaseWorkLifecycleSnapshotSchema.safeParse(value);
  return parsed.success
    ? { success: true, snapshot: parsed.data }
    : { success: false, error: "work_snapshot_invalid_response" };
}
