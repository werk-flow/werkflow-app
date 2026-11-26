import { expect, type Locator, type Page, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// A correction, expiry or payout takes its hours as „±HH:MM“, like the
// opening balance. Plain minutes or a zero mark and focus the hours field and
// send nothing; typing clears the mark. A valid value is sent as typed with
// the clicked kind, and the server parses it again.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'time-account-adjustment');
});

// The fixture page shows the table and the phone cards at once; the contract reads the table.
const row = (page: Page): Locator => page.getByRole('row').filter({ hasText: 'Kevin Kontrakt' });
const hours = (page: Page): Locator =>
  row(page).getByRole('textbox', { name: 'Stunden der Korrektur für Kevin Kontrakt', exact: true });
const kind = (page: Page, label: string): Locator => row(page).getByRole('button', { name: label, exact: true });

async function fillReason(page: Page): Promise<void> {
  await row(page)
    .getByRole('textbox', { name: 'Korrekturgrund für Kevin Kontrakt', exact: true })
    .fill('Überstunden aus dem Altsystem');
}

test('plain minutes mark and focus the hours field and send nothing', async ({ page }) => {
  await expect(page.getByRole('columnheader', { name: 'Stunden (Std:Min)' })).toBeVisible();
  await fillReason(page);
  await hours(page).fill('750');
  await kind(page, 'Korrektur').click();

  await expect(hours(page)).toBeFocused();
  await expect(hours(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('table')).toContainText(
    'Gib die Stunden als Std:Min an, etwa +12:30 oder -3:15.',
  );
  await expect(kind(page, 'Korrektur')).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);

  await hours(page).fill('-12:30');
  await expect(hours(page)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('table')).not.toContainText('Gib die Stunden als Std:Min an');
});

test('zero hours mark the field and send nothing', async ({ page }) => {
  await fillReason(page);
  await hours(page).fill('0:00');
  await kind(page, 'Auszahlung').click();
  await expect(hours(page)).toBeFocused();
  await expect(page.getByRole('table')).toContainText('Eine Korrektur von 0:00 ändert den Saldo nicht.');
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);
});

test('valid hours are sent as typed with the clicked kind', async ({ page }) => {
  await fillReason(page);
  await hours(page).fill('-12:30');
  await kind(page, 'Verfall').click();
  // While busy the button's name starts with its pending label.
  await expect(row(page).getByRole('button', { name: /Verfall$/ })).toHaveAttribute('aria-busy', 'true');
  await expectHeldWrite(page, 'submit-adjustment');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    accountId: 'contract-account',
    adjustmentKind: 'expiry',
    hours: '-12:30',
    effectiveDate: '2026-11-02',
    reason: 'Überstunden aus dem Altsystem',
  });
  await answerHeldWrite(page, null);
  await expect(page.getByRole('alert')).toContainText('Der Antrag ist gespeichert.');
  await expect(hours(page)).toHaveValue('');
});
