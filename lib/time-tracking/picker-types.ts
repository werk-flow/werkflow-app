import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

/**
 * Where a job stands for the caller, in the picker's order: the caller's job
 * in progress, a visit of the caller's today, the caller's next visit, the
 * caller's other jobs, then (office roles only) everyone else's. The database
 * ranks by it before it cuts the page (`search_clock_job_options`).
 */
export const PICKER_GROUPS = ['in_progress', 'today', 'upcoming', 'own', 'other'] as const;
export type PickerGroup = (typeof PICKER_GROUPS)[number];

/** The heading above each group of the picker list. */
export const PICKER_GROUP_LABELS: Record<PickerGroup, string> = {
  in_progress: 'In Ausführung',
  today: 'Heute geplant',
  upcoming: 'Demnächst geplant',
  own: 'Deine weiteren Aufträge',
  other: 'Weitere Aufträge',
};

/** A job of the clock-in and job-switch picker. */
export type PickerJob = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
  group: PickerGroup;
  /** The Berlin date (`YYYY-MM-DD`) of the caller's next visit after today, if any. */
  nextVisitDate: string | null;
};

export const PICKER_PAGE_SIZE = 50;

/** One read of the clock picker: the search text, how many rows the list shows, and the running job. */
export const jobPickerRequestSchema = z.object({
  organizationId: uuidSchema,
  query: z.string().trim().max(120).default(''),
  limit: z.number().int().min(1).max(1_000).default(PICKER_PAGE_SIZE),
  selectedJobId: uuidSchema.optional(),
});
