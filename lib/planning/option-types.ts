import type { ActionFailure } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

export const planningOptionRequestSchema = z
  .object({
    organizationId: uuidSchema,
    kind: z.enum(['employees', 'jobs', 'teams']),
    query: z.string().trim().max(120).default(''),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    selectedIds: z.array(uuidSchema).max(100).default([]),
    defaultUserIds: z.array(uuidSchema).max(100).default([]),
  })
  .refine(
    (input) => input.selectedIds.length + input.defaultUserIds.length <= 100,
    'Too many selected options',
  );
const planningOptionSchema = z.object({
  value: uuidSchema,
  label: z.string(),
  description: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  userId: uuidSchema.nullable(),
});
export const planningOptionsSchema = z.object({
  options: z.array(planningOptionSchema).max(50),
  selected: z.array(planningOptionSchema).max(100),
  hasMore: z.boolean(),
});
export type PlanningOptionRequest = z.input<typeof planningOptionRequestSchema>;
export type PlanningOption = z.output<typeof planningOptionSchema>;
export type PlanningOptionResult =
  | ({ success: true } & z.output<typeof planningOptionsSchema>)
  | ActionFailure;
