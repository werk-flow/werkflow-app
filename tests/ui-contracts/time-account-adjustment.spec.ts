import { expect, type Locator, type Page, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// A correction, expiry or payout takes its hours as „±HH:MM“, like the
// opening balance. Plain minutes, a zero, blank hours or a blank reason mark
// their fields, focus the first and send nothing; no browser bubble runs
// first. Typing clears a mark. A valid value is sent as typed with
// the clicked kind, and the server parses it again.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'time-account-adjustment');
});

// The fixture page shows the table and the phone cards at once; the contract reads the table.
const row = (page: Page): Locator => page.getByRole('row').filter({ hasText: 'Kevin Kontrakt' });
const hours = (page: Page): Locator =>
  row(page).getByRole('textbox', { name: 'Stunden der Korrektur für Kevin Kontrakt', exact: true });
const kind = (page: Page, label: string): Locator =>
  row(page).getByRole('button', { name: label, exact: true });

const reason = (page: Page): Locator =>
  row(page).getByRole('textbox', { name: 'Korrekturgrund für Kevin Kontrakt', exact: true });

async function fillReason(page: Page): Promise<void> {
  await reason(page).fill('Überstunden aus dem Altsystem');
}

test('blank hours and a blank reason mark both fields and focus the hours', async ({ page }) => {
  await kind(page, 'Korrektur').click();
  await expect(hours(page)).toBeFocused();
  await expect(hours(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(reason(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('table')).toContainText('Gib einen Grund für die Korrektur an.');
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);

  // Valid hours with the reason still blank move the focus to the reason.
  await hours(page).fill('+1:00');
  await kind(page, 'Korrektur').click();
  await expect(reason(page)).toBeFocused();
  await expect(hours(page)).not.toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);
});

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

test('a draft keeps the account version it was typed against across a live refresh', async ({ page }) => {
  await fillReason(page);
  await hours(page).fill('-8:00');
  // Another session changes the balance: the refreshed row shows the new version.
  await page.evaluate(() => {
    window.uiContractTimeAccounts = window.uiContractTimeAccounts.map((account) => ({
      ...account,
      currentBalanceMinutes: 120,
      version: account.version + 1,
    }));
    window.dispatchEvent(new Event('ui-contract:route-refresh'));
  });
  await expect(row(page)).toContainText('Saldo +2:00 Std.');
  await kind(page, 'Auszahlung').click();
  await expectHeldWrite(page, 'submit-adjustment');
  // The server refuses the old version as stale instead of booking the payout against the new balance.
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toMatchObject({
    expectedVersion: '1',
    hours: '-8:00',
  });
  await answerHeldWrite(page, 'stale_version');
  await expect(page.getByRole('alert')).toContainText('Lade die Seite neu und prüfe den Saldo.');

  // A retry of the unchanged draft is refused again: it still names the version it was typed against.
  await kind(page, 'Auszahlung').click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.calls.length)).toBe(2);
  expect(await page.evaluate(() => window.uiContractWrites.calls[1]?.input)).toMatchObject({
    expectedVersion: '1',
  });
});

test('an emptied date marks the row, focuses the date and sends nothing', async ({ page }) => {
  await fillReason(page);
  await hours(page).fill('+1:00');
  const date = row(page).getByRole('group', { name: 'Wirksamkeitsdatum für Kevin Kontrakt' });
  await date.getByRole('button', { name: 'Kalender öffnen' }).click();
  // Picking the selected day again empties the date.
  await page.getByRole('gridcell', { selected: true }).getByRole('button').click();
  await page.keyboard.press('Escape');
  await kind(page, 'Korrektur').click();
  await expect(date).toBeFocused();
  await expect(page.getByRole('table')).toContainText('Wähle das Datum, ab dem die Korrektur gilt.');
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);
});
