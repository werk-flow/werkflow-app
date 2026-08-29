import { expect, type Locator, type Page } from '@playwright/test';

import { retryDialogTransaction } from '../../golden/support/steps';

export async function deleteWorkScheduleViaDetail(
  page: Page,
  validFromLabel: string,
  note: string
): Promise<void> {
  // The schedule list has no semantic row marker. The note identifies the
  // owning list item; first() preserves the original lookup inside support.
  const row = page.locator('li').filter({ hasText: note }).first();
  const menuItem = page.getByRole('menuitem', { name: 'Löschen' });
  const confirmDialog = page.getByRole('alertdialog');

  await retryDialogTransaction({
    dialog: confirmDialog,
    open: async () => {
      if (await menuItem.isVisible().catch(() => false)) {
        await menuItem.press('Escape', { timeout: 5_000 });
      }
      await row
        .getByRole('button', {
          name: `Aktionen für Wochenplan ab ${validFromLabel}`,
        })
        .click({ timeout: 15_000 });
    },
    interact: async () => {
      await menuItem.click({ timeout: 10_000 });
      await confirmDialog.waitFor({ state: 'visible', timeout: 10_000 });
      await confirmDialog
        .getByRole('button', { name: 'Löschen', exact: true })
        .click({ timeout: 15_000 });
    },
  });

  await page.reload({ timeout: 30_000 });
  await expect(
    page.getByRole('button', {
      name: `Aktionen für Wochenplan ab ${validFromLabel}`,
    })
  ).toHaveCount(0);
}

export function vacationCalendarEvent(
  page: Page,
  status: 'pending' | 'approved',
  personName: string
): Locator {
  // FullCalendar exposes no semantic event role. The status class plus the
  // person name identifies the event; first() handles its mirrored rendering.
  return page.locator(`.fc-vacation-${status}`).filter({ hasText: personName }).first();
}

export function vacationRequestCard(page: Page, personName: string): Locator {
  // Approval cards expose only their data marker, so the raw selector stays in
  // this audit support helper and the person name scopes it to one request.
  return page.locator('[data-vacation-request]').filter({ hasText: personName });
}

export function absenceCalendarEvent(page: Page, label: string): Locator {
  // FullCalendar absence events have no semantic role or test id.
  return page.locator('.fc-vacation-approved').filter({ hasText: label });
}
