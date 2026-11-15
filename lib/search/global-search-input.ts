import { z } from '@/lib/zod';

import { uuidSchema } from '@/lib/validation/uuid';
import { GLOBAL_SEARCH_MIN_LENGTH, SEARCH_SOURCES, type GlobalSearchInput } from './global-search';

// The schema stays out of `./global-search`, which the lazy search dialog
// imports: zod in the dialog's chunk regroups the app shell's shared chunks
// (two more scripts on every cold start, lab.field.cold-start).

const GLOBAL_SEARCH_MAX_LENGTH = 120;

export const globalSearchInputSchema = z.object({
  organizationId: uuidSchema,
  query: z.string().trim().min(GLOBAL_SEARCH_MIN_LENGTH).max(GLOBAL_SEARCH_MAX_LENGTH),
  /** A retry names the failed sources; without it every source of the role reads. */
  sources: z.array(z.enum(SEARCH_SOURCES)).min(1).max(SEARCH_SOURCES.length).optional(),
}) satisfies z.ZodType<GlobalSearchInput>;
