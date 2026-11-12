import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// „Bearbeiten“ in the job page's actions menu opens the edit dialog on the
// title. The menu's focus return to its trigger pulled focus out of the
// dialog, whose trap took it back with the field's whole value selected: one
// stray keystroke replaced the Auftragsnummer, and then the title.

test('the job edit dialog opens on the title and leaves the Auftragsnummer unselected', async ({ page }) => {
  await openContractFixture(page, 'edit-job');
  const trigger = page.getByRole('button', { name: 'Aktionen öffnen' });
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  const dialog = page.getByRole('dialog', { name: 'Auftrag bearbeiten' });
  await expect(dialog.getByLabel('Titel')).toBeFocused();
  // The menu's close animation ends after the dialog opened; its focus return lands then.
  await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0);
  await page.keyboard.type('!');
  await expect(dialog.getByLabel('Titel')).toHaveValue('Heizkörper entlüften!');
  await expect(dialog.getByLabel('Auftragsnummer')).toHaveValue('AUF-2026-155');
  const numberSelection = await dialog
    .getByLabel('Auftragsnummer')
    .evaluate((input: HTMLInputElement) =>
      input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0),
    );
  expect(numberSelection, 'the Auftragsnummer keeps no selected text a keystroke could replace').toBe('');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger, 'closing the dialog returns focus to the menu that opened it').toBeFocused();
});

test('the actions menu closed without a choice returns focus to its trigger', async ({ page }) => {
  await openContractFixture(page, 'edit-job');
  const trigger = page.getByRole('button', { name: 'Aktionen öffnen' });
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
