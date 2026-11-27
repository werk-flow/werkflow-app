import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// werk-flow/werkflow-planning#368: a menu item that opens a dialog. The menu's
// close animation ends after the dialog opened, and its focus return to the
// trigger pulled focus out of the modal dialog; the dialog's trap took it back
// to its last field with the whole value selected. The registry menu now
// leaves focus in a dialog that opened since, for every menu.

test('focus stays in the customer edit dialog the row menu opened, and Escape returns it to the menu', async ({
  page,
}) => {
  await openContractFixture(page, 'customer-menu-edit');
  const trigger = page
    .getByRole('region', { name: 'Kundenzeile' })
    .getByRole('button', { name: 'Aktionen öffnen' });
  await trigger.click();
  // Radix runs the menu's focus return in a later task, as an event on the closed menu element.
  await page.getByRole('menu').evaluate((menu) => {
    window.uiContractMenuFocusReturn = new Promise<void>((resolve) => {
      menu.addEventListener('focusScope.autoFocusOnUnmount', () => queueMicrotask(resolve), { once: true });
    });
  });
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kunde bearbeiten' });
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Heizungsbau Weber');
  await expect(dialog.getByRole('textbox', { name: 'Name' })).toBeFocused();
  // The menu's close animation ends after the dialog opened; its focus return lands then.
  await page.evaluate(() => window.uiContractMenuFocusReturn);
  expect(
    await page.evaluate(() => window.uiContractDialogFocusLeaks),
    'focus never left the dialog the menu item opened',
  ).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger, 'closing the dialog returns focus to the menu that opened it').toBeFocused();
});

test('the customer row menu closed without a choice returns focus to its trigger', async ({ page }) => {
  await openContractFixture(page, 'customer-menu-edit');
  const trigger = page
    .getByRole('region', { name: 'Kundenzeile' })
    .getByRole('button', { name: 'Aktionen öffnen' });
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('a row menu inside an open dialog closed without a choice returns focus to its trigger there', async ({
  page,
}) => {
  await openContractFixture(page, 'customer-menu-edit');
  await page.getByRole('button', { name: 'Auswahl öffnen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kunde auswählen' });
  const trigger = dialog.getByRole('button', { name: 'Aktionen öffnen' });
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
});
