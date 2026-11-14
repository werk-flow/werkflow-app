import type { Locator, Page } from '@playwright/test';

// Copy and structure of Bereitschaft (components/on-call/).

const ON_CALL_COPY = {
  plan: 'Bereitschaft planen',
  handOver: 'Übergeben',
  rowActions: 'Aktionen öffnen',
} as const;

const ON_CALL_ROW_ACTIONS = {
  change: 'Ändern',
  end: 'Jetzt beenden',
  history: 'Verlauf',
} as const;

/** The on-call dialogs, each named by its title. */
const ON_CALL_DIALOGS = {
  plan: 'Bereitschaft planen',
  change: 'Bereitschaft ändern',
  handOver: 'Bereitschaft übergeben',
  history: 'Verlauf der Bereitschaft',
} as const;

/** The header button „Bereitschaft planen“ or „Übergeben“. */
export function onCallHeaderButton(page: Page, action: 'plan' | 'handOver'): Locator {
  return page.getByRole('main').getByRole('button', { name: ON_CALL_COPY[action], exact: true });
}

/** The action menu button of the shift row. */
export function onCallRowActions(page: Page, shiftId: string): Locator {
  return page
    .locator(`[data-row-id="${shiftId}"]`)
    .getByRole('button', { name: ON_CALL_COPY.rowActions, exact: true });
}

/** An item of an open row menu. */
export function onCallRowMenuItem(page: Page, action: keyof typeof ON_CALL_ROW_ACTIONS): Locator {
  return page.getByRole('menuitem', { name: ON_CALL_ROW_ACTIONS[action], exact: true });
}

export function onCallDialog(page: Page, dialog: keyof typeof ON_CALL_DIALOGS): Locator {
  return page.getByRole('dialog', { name: ON_CALL_DIALOGS[dialog], exact: true });
}

/** The confirmation that ends a running shift now. */
export function onCallEndConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: 'Bereitschaft jetzt beenden?', exact: true });
}
