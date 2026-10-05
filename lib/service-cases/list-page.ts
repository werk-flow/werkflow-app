import { z } from '@/lib/zod';

import { parseListPage } from '@/lib/ui/list-pagination';
import { SERVICE_CASE_STATUSES, type ServiceCaseListItem } from './types';

export const serviceCaseListQuerySchema = z.object({
  search: z.string().trim().max(250),
  /** `open` hides the three closing states; `all` lists every case. */
  status: z.enum(['open', 'all', ...SERVICE_CASE_STATUSES]),
  page: z.number().int().min(1).max(1_000_000),
});
export type ServiceCaseListQuery = z.infer<typeof serviceCaseListQuerySchema>;
export type ServiceCaseStatusFilter = ServiceCaseListQuery['status'];

export type ServiceCasePage = {
  cases: ServiceCaseListItem[];
  /** Cases that match the status scope and the search, before the page boundary. */
  total: number;
  /** False while the organization has no service case at all. */
  hasAnyCase: boolean;
};

/** URL state of `/service/faelle`; an unknown value falls back to the first page of the open cases. */
export function parseServiceCaseListQuery(
  params: Record<string, string | string[] | undefined>,
): ServiceCaseListQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    search: (single('q') ?? '').trim().slice(0, 250),
    status: serviceCaseListQuerySchema.shape.status.catch('open').parse(single('status')),
    page: parseListPage(single('page')),
  };
}
