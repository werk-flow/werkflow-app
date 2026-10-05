import { z } from '@/lib/zod';
import { Constants } from '@/lib/supabase/database.types';
import { uuidSchema } from '@/lib/validation/uuid';

// Input schemas of the time-tracking Server Actions in actions.ts. Every
// argument arrives from the network unchecked; each action parses it here
// before its first use and answers `invalid_input` when it does not fit.

/** Upper bound of ids one action call carries; batches above it are not a UI path. */
const ID_LIST_LIMIT = 5000;

const timestampSchema = z
  .string()
  .max(64)
  .refine((value) => Number.isFinite(Date.parse(value)));

const entryTypeSchema = z.enum(['clock_in', 'clock_out', 'break_start', 'break_end']);

export const addManualEntryInputSchema = z.object({
  organizationId: uuidSchema,
  targetUserId: uuidSchema,
  entries: z.array(z.object({ entryType: entryTypeSchema, timestamp: timestampSchema })).max(100),
  jobId: uuidSchema.optional(),
});

export const reviewEntriesInputSchema = z.object({
  entryIds: z.array(uuidSchema).max(ID_LIST_LIMIT),
  decision: z.enum(['approved', 'rejected']),
});

export const updateEntryInputSchema = z.object({
  entryId: uuidSchema,
  fields: z.object({
    timestamp: timestampSchema.optional(),
    entryType: entryTypeSchema.optional(),
    jobId: uuidSchema.nullable().optional(),
  }),
});

export const deleteEntryInputSchema = z.object({
  entryId: uuidSchema,
  pairedEntryId: uuidSchema.optional(),
});

export const entryIdListSchema = z.array(uuidSchema).max(ID_LIST_LIMIT);

export const getTimeEntriesInputSchema = z.object({
  organizationId: uuidSchema,
  from: z.string().max(64),
  to: z.string().max(64),
  userId: uuidSchema.optional(),
  status: z.enum(Constants.public.Enums.time_entry_status).optional(),
});

/** Calendar ids include synthetic ones (canonical segments); only persisted uuids are kept. */
export const calendarEntryIdListSchema = z.array(z.string().max(128)).max(ID_LIST_LIMIT);

export const reviewChangeRequestInputSchema = z.object({
  requestId: uuidSchema,
  action: z.enum(['approve', 'reject']),
});

export const optionalOrganizationIdSchema = uuidSchema.optional();
