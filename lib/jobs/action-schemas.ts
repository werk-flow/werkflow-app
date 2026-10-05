import { z } from '@/lib/zod';

import type { AssignmentApproval } from '@/lib/qualifications/types';
import { Constants } from '@/lib/supabase/database.types';
import { uuidSchema } from '@/lib/validation/uuid';

// Boundary schemas of the job Server Actions in ./actions.ts. The arguments
// arrive from the network unchecked; each field is bounded here before use.
// Blank strings keep their meaning (an empty id clears a reference, a blank
// title reaches the `title_or_description_required` check).

export const MAX_JOB_ASSIGNMENTS = 200;

const MAX_MINUTES = 100_000;

export const blankableUuidSchema = uuidSchema.or(z.literal(''));
export const blankableIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(''));
const minutesSchema = z.number().int().min(0).max(MAX_MINUTES);

/** A qualification override as the assignment dialog sends it. */
export const assignmentApprovalSchema = z
  .object({
    fingerprint: z.string().max(500),
    reason: z.string().max(2000),
    teamSourceId: uuidSchema.nullish(),
  })
  .transform(
    ({ teamSourceId, ...approval }): AssignmentApproval =>
      teamSourceId === undefined ? approval : { ...approval, teamSourceId },
  );

const jobFieldsShape = {
  title: z.string().max(500),
  description: z.string().max(20_000).nullish(),
  clientId: blankableUuidSchema.nullish(),
  projectId: blankableUuidSchema.nullish(),
  jobNumber: z.string().max(100).nullish(),
  priority: z.enum(Constants.public.Enums.job_priority).optional(),
  plannedWorkingMinutes: minutesSchema.nullish(),
  location: z.string().max(1000).nullish(),
  siteId: blankableUuidSchema.nullish(),
  contactId: blankableUuidSchema.nullish(),
  selectedUserIds: z.array(uuidSchema).max(MAX_JOB_ASSIGNMENTS).optional(),
  assignmentApproval: assignmentApprovalSchema.nullish(),
  assignmentTeamSourceId: uuidSchema.nullish(),
  templateVersionId: blankableUuidSchema.optional(),
};

export const createJobInputSchema = z.object({
  ...jobFieldsShape,
  plannedDate: blankableIsoDateSchema.optional(),
  plannedTime: z.string().max(20).optional(),
  estimatedDurationMinutes: minutesSchema.optional(),
});

export const updateJobArgumentsSchema = z.object({
  jobId: uuidSchema,
  input: z.object({
    ...jobFieldsShape,
    title: jobFieldsShape.title.optional(),
    plannedDate: blankableIsoDateSchema.nullish(),
    plannedTime: z.string().max(20).nullish(),
    estimatedDurationMinutes: minutesSchema.nullish(),
  }),
});

export const updateJobAssignmentsArgumentsSchema = z.object({
  jobId: uuidSchema,
  selectedUserIds: z.array(uuidSchema).max(MAX_JOB_ASSIGNMENTS * 2),
  approval: assignmentApprovalSchema.nullish(),
  teamSourceId: uuidSchema.nullish(),
});

/** A job number from the route segment, still URI-encoded. */
export const jobNumberLookupSchema = z.string().max(300);
