import { z } from '@/lib/zod';

import { parseListPage } from '@/lib/ui/list-pagination';

const listPageSchema = z.number().int().min(1).max(1_000_000);

export const maintenanceWorkspaceQuerySchema = z.object({
  search: z.string().trim().max(250),
  duePage: listPageSchema,
  planPage: listPageSchema,
  coveragePage: listPageSchema,
});
export type MaintenanceWorkspaceQuery = z.infer<typeof maintenanceWorkspaceQuerySchema>;

/** The URL parameter of each list's page; the search shares `q`. */
export const MAINTENANCE_PAGE_PARAMS = {
  due: 'duePage',
  plans: 'planPage',
  coverages: 'coveragePage',
} as const;

/** URL state of `/service/wartung`; an unknown value falls back to the first page of every list. */
export function parseMaintenanceWorkspaceQuery(
  params: Record<string, string | string[] | undefined>,
): MaintenanceWorkspaceQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    search: (single('q') ?? '').trim().slice(0, 250),
    duePage: parseListPage(single(MAINTENANCE_PAGE_PARAMS.due)),
    planPage: parseListPage(single(MAINTENANCE_PAGE_PARAMS.plans)),
    coveragePage: parseListPage(single(MAINTENANCE_PAGE_PARAMS.coverages)),
  };
}
