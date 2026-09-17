import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

export const jobOptionRequestSchema = z.object({
  organizationId: uuidSchema,
  kind: z.enum(['clients', 'projects', 'jobs']),
  query: z.string().trim().max(120).default(''),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  selectedIds: z.array(uuidSchema).max(10_000).default([]),
  clientId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  purpose: z.enum(['filter', 'job-project', 'project-jobs', 'manual-entry']).default('filter'),
});

export type JobOptionRequest = z.input<typeof jobOptionRequestSchema>;
export type JobEntityOption = {
  value: string;
  label: string;
  description?: string | undefined;
  clientId?: string | null;
  projectId?: string | null;
  status?: string;
};
export type JobOptionResult =
  | { success: true; options: JobEntityOption[]; selected: JobEntityOption[]; hasMore: boolean }
  | { success: false; error: string };
