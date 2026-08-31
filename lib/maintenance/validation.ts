import { z } from "zod";

import {
  MAINTENANCE_COVERAGE_STATUSES,
  MAINTENANCE_NEXT_DUE_BASES,
  MAINTENANCE_SCOPE_OUTCOMES,
} from "./types";

const nullableText = (minimum: number, maximum: number) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().min(minimum).max(maximum).optional().nullable(),
  );

const nullableDate = z.preprocess(
  (value) => (value === "" ? null : value),
  z.string().date().optional().nullable(),
);

export const maintenanceCoverageSchema = z
  .object({
    coverageId: z.string().uuid(),
    clientId: z.string().uuid(),
    siteId: z.string().uuid(),
    reference: nullableText(1, 160),
    description: nullableText(1, 5000),
    status: z.enum(MAINTENANCE_COVERAGE_STATUSES),
    validFrom: nullableDate,
    validUntil: nullableDate,
    noticeDate: nullableDate,
    renewalDate: nullableDate,
    reviewDueDate: nullableDate,
    operationalNote: nullableText(1, 5000),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (
      value.validFrom &&
      value.validUntil &&
      value.validUntil < value.validFrom
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Das Vertragsende darf nicht vor dem Beginn liegen.",
      });
    }
  });

export const maintenancePlanSchema = z
  .object({
    planId: z.string().uuid(),
    revisionId: z.string().uuid(),
    clientId: z.string().uuid(),
    siteId: z.string().uuid(),
    maintenanceCoverageId: z.string().uuid().optional().nullable(),
    status: z.enum(["draft", "active"]),
    templateVersionId: z.string().uuid(),
    effectiveFromDate: z.string().date(),
    firstDueDate: z.string().date(),
    intervalMonths: z.number().int().min(1).max(120),
    dueWindowBeforeDays: z.number().int().min(0).max(365),
    dueWindowAfterDays: z.number().int().min(0).max(365),
    plannedDurationMinutes: z.number().int().min(15).max(1440),
    nextDueBasis: z.enum(MAINTENANCE_NEXT_DUE_BASES),
    operationalInstructions: nullableText(1, 10000),
    overlapReason: nullableText(3, 1000),
    reason: z.string().trim().min(3).max(1000),
    equipmentIds: z
      .array(z.string().uuid())
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Jede Anlage darf nur einmal ausgewählt werden.",
      }),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (value.firstDueDate < value.effectiveFromDate) {
      context.addIssue({
        code: "custom",
        path: ["firstDueDate"],
        message:
          "Die erste Fälligkeit darf nicht vor dem Gültigkeitsbeginn liegen.",
      });
    }
  });

export const maintenanceTransitionSchema = z.object({
  planId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["active", "suspended", "terminated"]),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
});

export const maintenanceVisitLinkSchema = z
  .object({
    dueWorkIds: z.array(z.string().uuid()).min(1).max(20),
    expectedVersions: z.array(z.number().int().positive()).min(1).max(20),
    jobId: z.string().uuid(),
    planningOccurrenceId: z.string().uuid().optional().nullable(),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (value.dueWorkIds.length !== value.expectedVersions.length) {
      context.addIssue({
        code: "custom",
        path: ["expectedVersions"],
        message:
          "Für jede Fälligkeit muss genau eine erwartete Version übergeben werden.",
      });
    }
  });

export const maintenanceScheduleSchema = z.object({
  dueWorkId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  jobId: z.string().uuid(),
  startsAtLocal: z.string().datetime({ local: true }),
  durationMinutes: z.number().int().min(15).max(1440),
  idempotencyKey: z.string().uuid(),
});

export const maintenanceExceptionSchema = z.object({
  dueWorkId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  toStatus: z.enum(["skipped", "cancelled", "superseded"]),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
});

export const maintenanceCompletionSchema = z.object({
  dueWorkId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  scopeOutcome: z.enum(MAINTENANCE_SCOPE_OUTCOMES),
  completedOn: z.string().date(),
  workArtifactRevisionIds: z.array(z.string().uuid()).min(1).max(50),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: z.string().uuid(),
});
