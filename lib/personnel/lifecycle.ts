import { z } from "zod";
import { uuidSchema } from "@/lib/validation/uuid";

import type { Database } from "@/lib/supabase/database.types";

export type PersonnelAccessState =
  Database["public"]["Enums"]["personnel_access_state"];
export type PersonnelAccessTransitionKind =
  Database["public"]["Enums"]["personnel_access_transition_kind"];
export type PersonnelEmploymentState =
  Database["public"]["Enums"]["personnel_employment_state"];
export type PersonnelEmploymentTransitionKind =
  Database["public"]["Enums"]["personnel_employment_transition_kind"];
export type PersonnelDocumentAccessClass =
  Database["public"]["Enums"]["personnel_document_access_class"];
export type PersonnelDocumentEvidenceState =
  Database["public"]["Enums"]["personnel_document_evidence_state"];
export type PersonnelRequirementType =
  Database["public"]["Enums"]["personnel_requirement_type"];
export type PersonnelRequirementState =
  Database["public"]["Enums"]["personnel_requirement_state"];

const reasonSchema = z.string().trim().min(2).max(500);
const operationSchema = z.object({
  operationId: uuidSchema,
});

export const accessTransitionInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  transitionKind: z.enum([
    "schedule_activation",
    "activate_now",
    "suspend_now",
    "schedule_suspension",
    "cancel_scheduled",
    "reactivate",
    "end_access",
  ]),
  effectiveAt: z.iso.datetime({ offset: true }),
  reason: reasonSchema,
});

export const employmentTransitionInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  expectedVersion: z.number().int().nonnegative(),
  transitionKind: z.enum([
    "plan_start",
    "start",
    "record_notice",
    "plan_exit",
    "mark_inactive",
    "exit",
    "cancel_scheduled",
    "reverse",
    "reactivate",
  ]),
  effectiveOn: z.iso.date(),
  reason: reasonSchema,
  acceptUnresolvedWork: z.boolean().default(false),
});

export const createOnboardingPlanInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  templateVersionId: uuidSchema.nullable(),
  name: z.string().trim().min(2).max(160),
  targetStartDate: z.iso.date().nullable(),
});

export const saveRequirementInputSchema = operationSchema.extend({
  planId: uuidSchema,
  requirementId: uuidSchema.nullable(),
  expectedVersion: z.number().int().nonnegative(),
  requirementType: z.enum([
    "document",
    "qualification",
    "employment_condition",
    "work_schedule",
    "team",
    "access",
    "acknowledgement",
    "manual",
  ]),
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(1200).nullable(),
  isRequired: z.boolean(),
  blocksAccess: z.boolean(),
  ownerEmployeeRecordId: uuidSchema.nullable(),
  dueDate: z.iso.date().nullable(),
  state: z.enum([
    "missing",
    "pending",
    "fulfilled",
    "blocked",
    "waived",
    "cancelled",
  ]),
  blockerReason: z.string().trim().max(500).nullable(),
});

export const publishTemplateInputSchema = operationSchema.extend({
  templateId: uuidSchema.nullable(),
  expectedVersion: z.number().int().nonnegative(),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(1200).nullable(),
  items: z
    .array(
      z.object({
        requirementType: saveRequirementInputSchema.shape.requirementType,
        title: z.string().trim().min(2).max(180),
        description: z.string().trim().max(1200).nullable(),
        isRequired: z.boolean(),
        blocksAccess: z.boolean(),
        dueOffsetDays: z.number().int().min(-365).max(3650).nullable(),
      }),
    )
    .min(1)
    .max(50),
});

export const personnelDocumentUploadInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  documentId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  documentType: z.string().trim().min(2).max(120),
  accessClass: z.enum([
    "personnel_standard",
    "admin_restricted",
    "health_evidence",
  ]),
  evidenceState: z.enum(["pending", "valid", "expiring", "superseded"]),
  validUntil: z.iso.date().nullable(),
  cleanupToken: z.string().min(32).max(4096),
});

export const personnelDocumentUploadTicketInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().max(255).nullable().optional(),
  accessClass: z.enum(["personnel_standard", "admin_restricted", "health_evidence"]),
});

export const personnelDocumentUploadCleanupInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  documentId: uuidSchema,
  fileName: z.string().trim().min(1).max(255),
  accessClass: z.enum(["personnel_standard", "admin_restricted", "health_evidence"]),
  cleanupToken: z.string().min(32).max(4096),
});

export const acknowledgeRequirementInputSchema = operationSchema.extend({
  requirementId: uuidSchema,
  requirementVersion: z.number().int().positive(),
  statement: z.string().trim().min(2).max(500),
});

export const acknowledgeDocumentInputSchema = operationSchema.extend({
  personnelDocumentId: uuidSchema,
  documentVersionNumber: z.number().int().positive(),
  statement: z.string().trim().min(2).max(500),
});

export const personnelDocumentReleaseInputSchema = operationSchema.extend({
  employeeRecordId: uuidSchema,
  personnelDocumentId: uuidSchema,
  documentVersionNumber: z.number().int().positive(),
  release: z.boolean(),
  reason: z.string().trim().max(500).nullable(),
});

export const ACCESS_STATE_LABELS: Record<PersonnelAccessState, string> = {
  not_configured: "Nicht eingerichtet",
  scheduled: "Zugang geplant",
  active: "Aktiv",
  suspended: "Gesperrt",
  ended: "Beendet",
};

export const EMPLOYMENT_LIFECYCLE_LABELS: Record<PersonnelEmploymentState, string> = {
  planned: "Eintritt geplant",
  active: "Aktiv",
  notice: "Austritt vorgemerkt",
  inactive: "Inaktiv",
  exited: "Ausgeschieden",
};

export const REQUIREMENT_STATE_LABELS: Record<PersonnelRequirementState, string> = {
  missing: "Fehlt",
  pending: "Offen",
  fulfilled: "Erledigt",
  blocked: "Blockiert",
  waived: "Erlassen",
  cancelled: "Abgebrochen",
};

export function getEffectiveAccessState(
  lifecycle: {
    state: PersonnelAccessState;
    scheduledState: PersonnelAccessState | null;
    scheduledFor: string | null;
  } | null,
  now = Date.now(),
): PersonnelAccessState {
  if (!lifecycle) return "not_configured";
  if (
    lifecycle.scheduledState &&
    lifecycle.scheduledFor &&
    Date.parse(lifecycle.scheduledFor) <= now
  ) {
    return lifecycle.scheduledState;
  }
  return lifecycle.state;
}

export function getMembershipAccessMode(
  membership: {
    hasAccessBlocker: boolean;
    accessLifecycle: {
      state: PersonnelAccessState;
      scheduledState: PersonnelAccessState | null;
      scheduledFor: string | null;
    } | null;
  },
  now: number,
): "operational" | "prestart" | "blocked" {
  const lifecycle = membership.accessLifecycle;
  if (!lifecycle) return "operational";
  const scheduledAt = lifecycle.scheduledFor
    ? Date.parse(lifecycle.scheduledFor)
    : Number.NaN;
  const scheduledIsDue = Number.isFinite(scheduledAt) && scheduledAt <= now;
  if (
    scheduledIsDue &&
    lifecycle.scheduledState === "active" &&
    membership.hasAccessBlocker
  ) return "prestart";
  if (scheduledIsDue && lifecycle.scheduledState) {
    return lifecycle.scheduledState === "active" ? "operational" : "blocked";
  }
  if (lifecycle.state === "scheduled" && lifecycle.scheduledState === "active") {
    return "prestart";
  }
  return lifecycle.state === "active" ? "operational" : "blocked";
}

export function getOnboardingCompletion(requirements: Array<{
  isRequired: boolean;
  state: PersonnelRequirementState;
}>): { complete: number; total: number; isReady: boolean } {
  const required = requirements.filter((requirement) => requirement.isRequired);
  const complete = required.filter((requirement) =>
    requirement.state === "fulfilled" || requirement.state === "waived"
  ).length;
  // Optional-only plans are ready, but an empty plan cannot prove readiness.
  return {
    complete,
    total: required.length,
    isReady: requirements.length > 0 && complete === required.length,
  };
}

export function toTemplateRpcItems(
  items: Array<{
    requirementType: PersonnelRequirementType;
    title: string;
    description: string | null;
    isRequired: boolean;
    blocksAccess: boolean;
    dueOffsetDays: number | null;
  }>,
): Array<Record<string, string | number | boolean | null>> {
  return items.map((item) => ({
    requirementType: item.requirementType,
    title: item.title,
    description: item.description,
    isRequired: item.isRequired,
    blocksAccess: item.blocksAccess,
    dueOffsetDays: item.dueOffsetDays,
  }));
}
