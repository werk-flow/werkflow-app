import { z } from '@/lib/zod';
import { nullableTrimmedText } from '@/lib/validation/text';
import { uuidSchema } from '@/lib/validation/uuid';

import {
  SERVICE_CASE_CHARGE_CONTEXTS,
  SERVICE_CASE_RELATION_TYPES,
  SERVICE_CASE_STATUSES,
  SERVICE_CASE_URGENCIES,
} from './types';

export const serviceCaseCreateSchema = z
  .object({
    serviceCaseId: uuidSchema,
    idempotencyKey: uuidSchema,
    sourceRequestId: uuidSchema.optional().nullable(),
    clientId: uuidSchema.optional().nullable(),
    contactId: uuidSchema.optional().nullable(),
    siteId: uuidSchema.optional().nullable(),
    originalStatement: nullableTrimmedText(2, 5000),
    originalDetails: nullableTrimmedText(1, 10000),
    summary: nullableTrimmedText(2, 300),
    urgency: z.enum(SERVICE_CASE_URGENCIES).optional(),
    chargeContext: z.enum(SERVICE_CASE_CHARGE_CONTEXTS),
    accessInstructions: nullableTrimmedText(1, 3000),
    triageNote: nullableTrimmedText(1, 5000),
    equipmentIds: z.array(uuidSchema).max(30),
  })
  .superRefine((input, context) => {
    if (input.sourceRequestId) return;
    for (const [field, value] of [
      ['clientId', input.clientId],
      ['siteId', input.siteId],
      ['originalStatement', input.originalStatement],
      ['summary', input.summary],
    ] as const) {
      if (!value?.trim()) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Dieses Feld ist erforderlich.',
        });
      }
    }
  });

export const serviceCaseUpdateSchema = z
  .object({
    serviceCaseId: uuidSchema,
    expectedVersion: z.number().int().positive(),
    summary: z.string().trim().min(2).max(300),
    urgency: z.enum(SERVICE_CASE_URGENCIES),
    status: z.enum(SERVICE_CASE_STATUSES),
    chargeContext: z.enum(SERVICE_CASE_CHARGE_CONTEXTS),
    accessInstructions: nullableTrimmedText(1, 3000),
    triageNote: nullableTrimmedText(1, 5000),
    resolutionNote: nullableTrimmedText(3, 5000),
    jobId: uuidSchema.optional().nullable(),
    equipmentIds: z.array(uuidSchema).max(30),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: uuidSchema,
  })
  .superRefine((input, context) => {
    if (
      ['resolved', 'closed_without_visit', 'duplicate'].includes(input.status) &&
      !input.resolutionNote?.trim()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resolutionNote'],
        message: 'Für den Abschluss ist eine Begründung erforderlich.',
      });
    }
  });

export const serviceCaseRelationSchema = z.object({
  serviceCaseId: uuidSchema,
  relatedServiceCaseId: uuidSchema,
  relationType: z.enum(SERVICE_CASE_RELATION_TYPES),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
  idempotencyKey: uuidSchema,
});

export const serviceCaseEvidenceSchema = z.object({
  serviceCaseId: uuidSchema,
  workArtifactRevisionId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  idempotencyKey: uuidSchema,
});
