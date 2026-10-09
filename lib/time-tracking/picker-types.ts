import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

/** A job of the clock-in and job-switch picker. */
export type PickerJob = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
  /** The caller is assigned to a scheduled visit of this job on today's Berlin date. */
  plannedToday: boolean;
};

export const PICKER_PAGE_SIZE = 50;

/** One read of the clock picker: the search text, how many rows the list shows, and the running job. */
export const jobPickerRequestSchema = z.object({
  organizationId: uuidSchema,
  query: z.string().trim().max(120).default(''),
  limit: z.number().int().min(1).max(1_000).default(PICKER_PAGE_SIZE),
  selectedJobId: uuidSchema.optional(),
});
