import { expect, type Locator, type Page } from '@playwright/test';
import { SEARCH_GROUP_LABELS, type SearchGroupKind } from '../../../../lib/search/global-search';
import { escapeRegExp } from './shared';

// E8 — the header search (components/search/).

const SEARCH_COPY = {
  title: 'Suchen',
  field: 'Suchbegriff',
  noHits: 'Keine Treffer gefunden',
} as const;

/** The header search's layer, named by its title. */
export function globalSearchDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: SEARCH_COPY.title, exact: true });
}

/**
 * Opens the header search (the sidebar's „Suchen“ on the desktop) and types
 * the query. A newly opened search holds no earlier answer, so whatever it
 * shows next answers this query.
 */
export async function searchEverywhere(page: Page, query: string): Promise<Locator> {
  const dialog = globalSearchDialog(page);
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: SEARCH_COPY.title, exact: true }).click();
  await dialog.getByRole('textbox', { name: SEARCH_COPY.field, exact: true }).fill(query);
  return dialog;
}

/** A hit of one kind, by the title its link starts with; the link's name goes on with the hit's details. */
export function searchHit(dialog: Locator, kind: SearchGroupKind, title: string): Locator {
  return dialog
    .getByRole('region', { name: SEARCH_GROUP_LABELS[kind], exact: true })
    .getByRole('link', { name: new RegExp(`^${escapeRegExp(title)}`) });
}

/** The answer of a query that matched nothing the role may find. */
export function searchFoundNothing(dialog: Locator): Locator {
  return dialog.getByText(SEARCH_COPY.noHits, { exact: true });
}
