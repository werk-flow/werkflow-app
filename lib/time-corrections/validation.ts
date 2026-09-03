import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

import type { TimeCorrectionKind } from './types';

export const timeCorrectionSourceInputSchema = z.object({
  kind: z.enum([
    'legacy_entry',
    'canonical_session',
    'canonical_segment',
    'correction_application',
  ]),
  id: uuidSchema,
});

export const timeCorrectionFactInputSchema = z.object({
  factId: z.string().min(1).max(100),
  employeeRecordId: uuidSchema,
  entryType: z.enum(['clock_in', 'clock_out', 'break_start', 'break_end']),
  timestamp: z.iso.datetime({ offset: true }),
  jobId: uuidSchema.nullable().optional(),
  activityKind: z
    .enum(['work', 'travel', 'break', 'standby', 'callout', 'internal_activity'])
    .nullable()
    .optional(),
});

export const submitTimeCorrectionSchema = z.object({
  organizationId: uuidSchema,
  subjectEmployeeRecordId: uuidSchema,
  kind: z.enum([
    'add',
    'edit',
    'delete',
    'split',
    'reclassify',
    'reallocate',
    'reassign',
    'missed_clock',
  ]),
  reason: z.string().trim().min(3).max(2000),
  source: timeCorrectionSourceInputSchema.nullable(),
  proposedFacts: z.array(timeCorrectionFactInputSchema).max(20),
  operationId: uuidSchema,
});

export type SubmitTimeCorrectionInput = z.infer<
  typeof submitTimeCorrectionSchema
>;

export const reviseTimeCorrectionSchema = submitTimeCorrectionSchema.omit({
  organizationId: true,
  subjectEmployeeRecordId: true,
  kind: true,
}).extend({
  requestId: uuidSchema,
  expectedRevision: z.number().int().positive(),
});

export type ReviseTimeCorrectionInput = z.infer<
  typeof reviseTimeCorrectionSchema
>;

export const reviewTimeCorrectionSchema = z.object({
  requestId: uuidSchema,
  expectedRevision: z.number().int().positive(),
  decision: z.enum(['approve', 'reject', 'clarify']),
  comment: z.string().trim().max(2000).nullable(),
  operationId: uuidSchema,
});

export type ReviewTimeCorrectionInput = z.infer<
  typeof reviewTimeCorrectionSchema
>;

export function validateCorrectionShape(input: {
  kind: TimeCorrectionKind;
  hasSource: boolean;
  proposedFactCount: number;
}): string | null {
  if (input.kind === 'add' || input.kind === 'missed_clock') {
    if (input.hasSource || input.proposedFactCount < 1) return 'invalid_shape';
    return null;
  }
  if (!input.hasSource) return 'source_required';
  if (input.kind === 'delete') {
    return input.proposedFactCount === 0 ? null : 'invalid_shape';
  }
  if (input.kind === 'split') {
    return input.proposedFactCount >= 4 ? null : 'invalid_shape';
  }
  return input.proposedFactCount > 0 ? null : 'invalid_shape';
}
