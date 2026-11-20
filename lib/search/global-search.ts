import type { ActionResult } from '@/lib/action-result';

/**
 * The header search (docs/features/customers-and-crm.md, "Search"). Each
 * source is one domain's own list reader; one read can fill several groups.
 */
export const SEARCH_SOURCES = ['kunden', 'auftraege', 'anfragen', 'anlagen', 'dokumente'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

export type SearchGroupKind =
  | 'kunden'
  | 'einsatzorte'
  | 'ansprechpartner'
  | 'auftraege'
  | 'anfragen'
  | 'anlagen'
  | 'dokumente';

export const SEARCH_GROUP_LABELS: Record<SearchGroupKind, string> = {
  kunden: 'Kunden',
  einsatzorte: 'Einsatzorte',
  ansprechpartner: 'Ansprechpartner',
  auftraege: 'Aufträge und Projekte',
  anfragen: 'Anfragen',
  anlagen: 'Anlagen',
  dokumente: 'Dokumente',
};

/** The hits shown per group; „Alle anzeigen“ opens the domain's list with the query. */
export const GLOBAL_SEARCH_LIMIT = 5;
/** A shorter query reads nothing: every list would match. */
export const GLOBAL_SEARCH_MIN_LENGTH = 2;
/** The input of the `global-search` background read (`./global-search-input`). */
export type GlobalSearchInput = {
  organizationId: string;
  query: string;
  sources?: SearchSource[] | undefined;
};

export type SearchHit = { id: string; title: string; detail: string | null; href: string };

export type SearchGroup =
  | {
      kind: SearchGroupKind;
      source: SearchSource;
      status: 'loaded';
      hits: SearchHit[];
      /** Every match of the domain list, or null when the list counts another record. */
      total: number | null;
      /** The domain list with the query; null when the role has no such list. */
      moreHref: string | null;
    }
  | { kind: SearchGroupKind; source: SearchSource; status: 'failed' };

/** The groups of the query they answer, so a retry of one source reads the same query. */
export type GlobalSearchResult = ActionResult<{ query: string; groups: SearchGroup[] }>;

/**
 * The sources a role searches. Admin and Büro search every domain; an
 * employee only the jobs and projects the job list shows them and the
 * Anlagen of their assigned jobs. Never Mitarbeiter, time, absences,
 * sickness, qualifications, prices or costs.
 */
export function searchSourcesFor(isManagerOrAbove: boolean): readonly SearchSource[] {
  return isManagerOrAbove ? SEARCH_SOURCES : ['auftraege', 'anlagen'];
}

export const SEARCH_SOURCE_GROUPS: Record<SearchSource, readonly SearchGroupKind[]> = {
  kunden: ['kunden', 'einsatzorte', 'ansprechpartner'],
  auftraege: ['auftraege'],
  anfragen: ['anfragen'],
  anlagen: ['anlagen'],
  dokumente: ['dokumente'],
};

/** The list a group's „Alle anzeigen“ opens, filtered by the query. */
export function searchListHref(source: SearchSource, query: string): string {
  const q = encodeURIComponent(query);
  switch (source) {
    case 'kunden':
      return `/kunden?q=${q}`;
    case 'auftraege':
      return `/auftraege?active_q=${q}&parked_q=${q}&archived_q=${q}&archived_open=1`;
    case 'anfragen':
      return `/anfragen?status=alle&q=${q}`;
    case 'anlagen':
      return `/service/anlagen?q=${q}`;
    case 'dokumente':
      return `/dokumente?view=all&q=${q}`;
  }
}

/** Joins the present parts of a hit's second line. */
export function hitDetail(parts: ReadonlyArray<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => Boolean(part?.trim()));
  return present.length > 0 ? present.join(' · ') : null;
}
