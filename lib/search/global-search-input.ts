import { z } from '@/lib/zod';

import { uuidSchema } from '@/lib/validation/uuid';
import { GLOBAL_SEARCH_MIN_LENGTH, SEARCH_SOURCES, type GlobalSearchInput } from './global-search';

// The input check of the `global-search` background read. It lives apart from
// `./global-search`, which the lazy search dialog imports, so the dialog's
// chunk carries only what it renders.

const GLOBAL_SEARCH_MAX_LENGTH = 120;

export const globalSearchInputSchema = z.object({
  organizationId: uuidSchema,
  query: z.string().trim().min(GLOBAL_SEARCH_MIN_LENGTH).max(GLOBAL_SEARCH_MAX_LENGTH),
  /** A retry names the failed sources; without it every source of the role reads. */
  sources: z.array(z.enum(SEARCH_SOURCES)).min(1).max(SEARCH_SOURCES.length).optional(),
}) satisfies z.ZodType<GlobalSearchInput>;
