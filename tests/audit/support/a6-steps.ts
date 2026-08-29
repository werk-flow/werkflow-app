import type { Locator, Page } from '@playwright/test';

import { expect } from '../../golden/support/fixtures';

// FullCalendar exposes the date only as a data attribute, so this raw lookup
// stays in audit support and is narrowed by both date and run-scoped title.
export function planningOccurrenceInDateCell(page: Page, dateIso: string, title: string): Locator {
  return page
    .locator(`.fc-daygrid-day[data-date="${dateIso}"]`)
    .locator('.fc-event-job')
    .filter({ hasText: title });
}

export function planningDateCellStatus(page: Page, dateIso: string, status: string): Locator {
  return page.locator(`.fc-daygrid-day[data-date="${dateIso}"]`).getByText(status, { exact: true });
}

// Request cards can render in both responsive layouts. The date is the stable
// business identity, and this helper picks the visible action copy as before.
export function pendingVacationWithdrawButton(page: Page, germanDate: string): Locator {
  const escapedDate = germanDate.replace(/\./g, '\\.');
  return page
    .getByRole('button', {
      name: new RegExp(`^Urlaubsantrag vom .*${escapedDate}.* zurückziehen$`),
    })
    .first();
}

// The dialog deliberately has two equally named close controls. The footer
// button is the first one in DOM order and is the intended interaction here.
export async function closePlanningDialogWithNamedControl(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Schließen' }).first().click();
}

// Notification rows have no semantic group role. Keep the raw state marker
// here and drain one persisted row at a time with a bounded progress check.
export async function markAllUnreadNotificationsRead(page: Page): Promise<void> {
  const unreadRows = page.locator('[data-unread="true"]');
  let unreadCount = await unreadRows.count();
  while (unreadCount > 0) {
    await unreadRows
      .first()
      .getByRole('button', {
        name: /^Benachrichtigung vom .* als gelesen markieren$/,
      })
      .click({ timeout: 15_000 });
    await expect
      .poll(async () => unreadRows.count(), { timeout: 15_000 })
      .toBeLessThan(unreadCount);
    unreadCount = await unreadRows.count();
  }
}
