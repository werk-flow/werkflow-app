import { z } from "zod";
import { uuidSchema } from "@/lib/validation/uuid";

import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_IDENTIFIER_TYPES,
  EQUIPMENT_STATES,
  EQUIPMENT_SUBTYPES,
  EQUIPMENT_SUBTYPES_BY_CATEGORY,
  type EquipmentSubtype,
} from "./types";

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable();
const optionalDate = z
  .union([z.string().date(), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);

export const equipmentIdentifierSchema = z.object({
  identifierType: z.enum(EQUIPMENT_IDENTIFIER_TYPES),
  value: z.string().trim().min(1).max(200),
  issuer: optionalText(160),
});

export const equipmentFormSchema = z
  .object({
    clientId: uuidSchema,
    siteId: uuidSchema,
    parentEquipmentId: uuidSchema.optional().nullable(),
    name: z.string().trim().min(2).max(160),
    category: z.enum(EQUIPMENT_CATEGORIES),
    subtype: z.enum(EQUIPMENT_SUBTYPES).optional().nullable(),
    state: z.enum(EQUIPMENT_STATES),
    manufacturer: optionalText(160),
    model: optionalText(160),
    locationDetail: optionalText(300),
    technicalNotes: optionalText(4000),
    installationDate: optionalDate,
    commissioningDate: optionalDate,
    warrantyProvider: optionalText(200),
    warrantyBasis: optionalText(2000),
    warrantyStartDate: optionalDate,
    warrantyEndDate: optionalDate,
    identifiers: z.array(equipmentIdentifierSchema).max(30),
    reason: optionalText(1000),
    effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
  })
  .superRefine((input, context) => {
    const validSubtypes = EQUIPMENT_SUBTYPES_BY_CATEGORY[
      input.category
    ] as readonly EquipmentSubtype[];
    if (input.subtype && !validSubtypes.includes(input.subtype)) {
      context.addIssue({
        code: "custom",
        path: ["subtype"],
        message: "Der Untertyp passt nicht zur gewählten Kategorie.",
      });
    }
    if (input.category === "system_component" && !input.parentEquipmentId) {
      context.addIssue({
        code: "custom",
        path: ["parentEquipmentId"],
        message: "Eine Komponente benötigt eine übergeordnete Anlage.",
      });
    }
    if (input.category !== "system_component" && input.parentEquipmentId) {
      context.addIssue({
        code: "custom",
        path: ["parentEquipmentId"],
        message: "Nur Komponenten können einer Anlage untergeordnet werden.",
      });
    }
    if (
      input.warrantyStartDate &&
      input.warrantyEndDate &&
      input.warrantyEndDate < input.warrantyStartDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["warrantyEndDate"],
        message: "Das Gewährleistungsende darf nicht vor dem Beginn liegen.",
      });
    }
  });

export const equipmentUpdateSchema = equipmentFormSchema.safeExtend({
  equipmentId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: uuidSchema,
});

export const equipmentCreateSchema = equipmentFormSchema.safeExtend({
  equipmentId: uuidSchema,
  idempotencyKey: uuidSchema,
});

export const equipmentTransitionSchema = z.object({
  equipmentId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  toState: z.enum(EQUIPMENT_STATES),
  effectiveAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: uuidSchema,
});

export const equipmentArchiveSchema = z.object({
  equipmentId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  archived: z.boolean(),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: uuidSchema,
});

export const equipmentReplacementSchema = equipmentFormSchema.safeExtend({
  predecessorId: uuidSchema,
  successorId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  effectiveAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: uuidSchema,
});

export const equipmentCorrectionSchema = z.object({
  equipmentId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  correctsEventId: uuidSchema,
  effectiveAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: uuidSchema,
});

export const equipmentWorkLinkSchema = z
  .object({
    equipmentId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    jobId: uuidSchema.optional().nullable(),
    projectId: uuidSchema.optional().nullable(),
    linked: z.boolean(),
    reason: optionalText(1000),
    idempotencyKey: uuidSchema,
  })
  .refine(
    (input) =>
      Number(Boolean(input.jobId)) + Number(Boolean(input.projectId)) === 1,
    {
      message: "Genau ein Arbeitsbezug ist erforderlich.",
      path: ["jobId"],
    },
  );

export const equipmentSourceSchema = z
  .object({
    equipmentId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    targetType: z.enum([
      "job",
      "project",
      "artifact_revision",
      "handover_release",
      "document",
    ]),
    targetId: uuidSchema,
    documentVersionNumber: z.number().int().positive().optional().nullable(),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: uuidSchema,
  })
  .superRefine((input, context) => {
    const hasDocumentVersion = Boolean(input.documentVersionNumber);
    if ((input.targetType === "document") !== hasDocumentVersion) {
      context.addIssue({
        code: "custom",
        path: ["documentVersionNumber"],
        message: "Für ein Dokument ist eine exakte Version erforderlich.",
      });
    }
  });
