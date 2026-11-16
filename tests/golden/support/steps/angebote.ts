import type { Locator, Page } from '@playwright/test';
import { listEntry } from './shared';

// Copy and structure of the Angebote area (components/angebote/).

const LEISTUNGEN_COPY = {
  createLeistung: 'Leistung anlegen',
  rowActions: 'Aktionen öffnen',
} as const;

const LEISTUNG_ROW_ACTIONS = {
  prices: 'Preise',
  edit: 'Bearbeiten',
  archive: 'Archivieren',
  restore: 'Wiederherstellen',
} as const;

/** The Leistung dialogs, each named by its heading. */
const LEISTUNG_DIALOGS = {
  create: 'Leistung anlegen',
  edit: 'Leistung bearbeiten',
} as const;

/** The header button „Leistung anlegen“. */
export function createLeistungButton(page: Page): Locator {
  return page.getByRole('main').getByRole('button', { name: LEISTUNGEN_COPY.createLeistung, exact: true });
}

/** A Leistung dialog as an open layer, named by its title. */
export function leistungDialogLayer(page: Page, dialog: keyof typeof LEISTUNG_DIALOGS): Locator {
  return page.getByRole('dialog', { name: LEISTUNG_DIALOGS[dialog], exact: true });
}

/** The open price dialog of a Leistung („Preise von „…““). */
export function leistungPriceDialogLayer(page: Page): Locator {
  return page.getByRole('dialog', { name: /^Preise von „/ });
}

/** The visible row or phone card of the Leistung named `name`. */
export function leistungRow(page: Page, name: string): Locator {
  return listEntry(page.getByRole('main'), { has: page.getByText(name, { exact: true }) });
}

export function leistungRowActionsButton(row: Locator): Locator {
  return row.getByRole('button', { name: LEISTUNGEN_COPY.rowActions, exact: true });
}

/** One item of the open row menu. */
export function leistungRowActionItem(page: Page, action: keyof typeof LEISTUNG_ROW_ACTIONS): Locator {
  return page.getByRole('menuitem', { name: LEISTUNG_ROW_ACTIONS[action], exact: true });
}
