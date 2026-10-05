import { z } from '@/lib/zod';

import { parseListPage } from '@/lib/ui/list-pagination';
import { REQUEST_CATEGORY_LABELS, type ClientRequest, type RequestCategory } from './types';

const REQUEST_STATUS_FILTERS = ['aktiv', 'umgewandelt', 'geschlossen', 'alle'] as const;
export type RequestStatusFilter = (typeof REQUEST_STATUS_FILTERS)[number];

export type RequestListEntry = {
  request: ClientRequest;
  clientName: string | null;
  assigneeName: string | null;
  convertedLabel: string | null;
};

export type RequestListQuery = {
  status: RequestStatusFilter;
  search: string;
  page: number;
};

export type RequestPage = {
  entries: RequestListEntry[];
  /** Requests that match the status scope and the search, before the page boundary. */
  total: number;
  /** False while the organization has no request at all. */
  hasAnyRequest: boolean;
};

/** URL state of `/anfragen`; an unknown value falls back to the first page of the active requests. */
export function parseRequestListQuery(
  params: Record<string, string | string[] | undefined>,
): RequestListQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    status: z.enum(REQUEST_STATUS_FILTERS).catch('aktiv').parse(single('status')),
    search: (single('q') ?? '').trim().slice(0, 250),
    page: parseListPage(single('page')),
  };
}

/** The categories whose German label contains the search text; the database matches the enum values. */
export function requestCategoriesMatching(search: string): RequestCategory[] {
  const query = search.trim().toLocaleLowerCase('de');
  if (!query) return [];
  return (Object.keys(REQUEST_CATEGORY_LABELS) as RequestCategory[]).filter((category) =>
    REQUEST_CATEGORY_LABELS[category].toLocaleLowerCase('de').includes(query),
  );
}
