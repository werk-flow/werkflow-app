import type { ActionResult } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

/**
 * One request of an entity picker: a kind, an optional purpose that narrows
 * the eligible records, the search text, the continuation offset and the
 * selected ids whose labels must stay known across searches. The server reads
 * one page of 50 in the whole permitted scope.
 */
export const jobOptionRequestSchema = z.object({
  organizationId: uuidSchema,
  kind: z.enum(['clients', 'projects', 'jobs', 'equipment', 'service-cases', 'inventory-items', 'coverages']),
  query: z.string().trim().max(120).default(''),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  selectedIds: z.array(uuidSchema).max(10_000).default([]),
  clientId: uuidSchema.optional(),
  projectId: uuidSchema.optional(),
  siteId: uuidSchema.optional(),
  purpose: z
    .enum([
      'filter',
      // Projects a job may join: open ones of the job's customer or of none.
      'job-project',
      // Jobs a project may take: unassigned and not finished, or already its own.
      'project-jobs',
      // Open jobs time may be booked on; employees see their assignments.
      'manual-entry',
      // Open jobs of the organization a time correction may name, for every member.
      'time-correction',
      // Work at one customer's site: the equipment page and a service case.
      'equipment-work',
    ])
    .default('filter'),
});

export type JobOptionRequest = z.input<typeof jobOptionRequestSchema>;

/** A picker choice. The optional fields carry what a form copies from the chosen record. */
export type JobEntityOption = {
  value: string;
  label: string;
  description?: string | undefined;
  clientId?: string | null;
  projectId?: string | null;
  status?: string;
  /** Projects: the customer's name and the site and contact a job form copies. */
  clientName?: string | null;
  siteId?: string | null;
  contactId?: string | null;
  /** Projects and jobs: the record number, for links and labels. */
  number?: string | null;
  /** Projects: the name without the number. */
  name?: string;
  /** Projects: the open state's inputs. */
  statusOverride?: string | null;
  jobCount?: number;
  completedJobCount?: number;
  /** Inventory items: what a material line copies. */
  unit?: string;
  isBillable?: boolean;
};
export type JobOptionResult = ActionResult<{
  options: JobEntityOption[];
  selected: JobEntityOption[];
  hasMore: boolean;
}>;
