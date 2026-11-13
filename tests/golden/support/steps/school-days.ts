import type { Locator, Page } from '@playwright/test';

// The office's Berufsschule section on the member detail
// (components/mitarbeiter/school-days-section.tsx).

const SCHOOL_DAY_DIALOG_TITLES = {
  add: 'Berufsschule erfassen',
  end: 'Enddatum setzen',
} as const;

const SCHOOL_DAY_MENU_ITEMS = {
  end: 'Enddatum setzen',
  cancel: 'Stornieren',
} as const;

/** The section's action that opens the add dialog. */
export function addSchoolDayButton(page: Page): Locator {
  return page.getByRole('main').getByRole('button', { name: SCHOOL_DAY_DIALOG_TITLES.add, exact: true });
}

export function schoolDayDialog(page: Page, dialog: keyof typeof SCHOOL_DAY_DIALOG_TITLES): Locator {
  return page.getByRole('dialog', { name: SCHOOL_DAY_DIALOG_TITLES[dialog], exact: true });
}

/** The cancellation's confirmation. */
export function schoolDayCancelConfirmation(page: Page): Locator {
  return page.getByRole('alertdialog', { name: 'Berufsschule stornieren?', exact: true });
}

/** The actions menu trigger of one rule; `description` is describeSchoolDay's text. */
export function schoolDayActionsButton(page: Page, description: string): Locator {
  return page.getByRole('button', { name: `Aktionen für ${description}`, exact: true });
}

export function schoolDayMenuItem(page: Page, item: keyof typeof SCHOOL_DAY_MENU_ITEMS): Locator {
  return page.getByRole('menuitem', { name: SCHOOL_DAY_MENU_ITEMS[item], exact: true });
}
