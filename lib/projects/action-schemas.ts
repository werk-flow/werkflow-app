import { z } from '@/lib/zod';

import { blankableIsoDateSchema, blankableUuidSchema } from '@/lib/jobs/action-schemas';
import { uuidSchema } from '@/lib/validation/uuid';

// Boundary schemas of the project Server Actions in ./actions.ts: the arguments arrive from the network unchecked. Blank
// strings keep their meaning (an empty id or date clears the value).

const projectFieldsSchema = z.object({
  name: z.string().max(500),
  description: z.string().max(20_000).nullish(),
  clientId: blankableUuidSchema.nullish(),
  projectNumber: z.string().max(100).nullish(),
  plannedStartDate: blankableIsoDateSchema.nullish(),
  plannedEndDate: blankableIsoDateSchema.nullish(),
  siteId: blankableUuidSchema.nullish(),
  contactId: blankableUuidSchema.nullish(),
});

export const createProjectInputSchema = projectFieldsSchema.extend({
  templateVersionId: blankableUuidSchema.optional(),
});
export const updateProjectArgumentsSchema = z.object({
  projectId: uuidSchema,
  input: projectFieldsSchema.partial(),
});
