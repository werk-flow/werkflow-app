import { parseListPage } from '@/lib/ui/list-pagination';
import { z } from '@/lib/zod';
import type { LeistungListEntry } from './types';

const LEISTUNG_LIST_VIEWS = ['aktiv', 'archiviert'] as const;
export type LeistungListView = (typeof LEISTUNG_LIST_VIEWS)[number];
export const leistungListViewSchema = z.enum(LEISTUNG_LIST_VIEWS);

export type LeistungListQuery = {
  view: LeistungListView;
  search: string;
  page: number;
};

export type LeistungPage = {
  entries: LeistungListEntry[];
  /** Leistungen that match the view and the search, before the page boundary. */
  total: number;
  /** False while the organization has no Leistung at all. */
  hasAnyLeistung: boolean;
  /** The Berlin day whose prices the list shows, `YYYY-MM-DD`. */
  priceDate: string;
};

/** URL state of `/angebote/leistungen`; an unknown value falls back to the first page of the active ones. */
export function parseLeistungListQuery(
  params: Record<string, string | string[] | undefined>,
): LeistungListQuery {
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };
  return {
    view: leistungListViewSchema.catch('aktiv').parse(single('ansicht')),
    search: (single('q') ?? '').trim().slice(0, 250),
    page: parseListPage(single('page')),
  };
}
