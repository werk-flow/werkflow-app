import { expect, type Locator, type Page, test } from '@playwright/test';
import { textInDom } from '../golden/support/steps/shared';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Missing time accounts open with one shared date and reason and one balance
// per person as „±HH:MM“. Enter in a balance opens that person's account only;
// Enter in the shared reason opens nothing. A balance that is no hours-and-minutes time marks
// and focuses its field and sends nothing. „Alle eröffnen“ shows its pending
// state in the first frame and sends every listed person in one write; a
// refusal stays at the form with the typed balances.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'time-account-bulk-opening');
});

const form = (page: Page): Locator => page.getByRole('region', { name: 'Zeitkonten eröffnen' });
// The fixture page shows the table and the phone cards at once; the contract reads the table.
const rowOf = (page: Page, employeeName: string): Locator =>
  form(page).getByRole('row').filter({ hasText: employeeName });
const balanceOf = (page: Page, employeeName: string): Locator =>
  rowOf(page, employeeName).getByRole('textbox', { name: `Anfangssaldo für ${employeeName}`, exact: true });
const openOne = (page: Page, employeeName: string): Locator =>
  rowOf(page, employeeName).getByRole('button', { name: `Zeitkonto für ${employeeName} eröffnen` });
const openAll = (page: Page): Locator => form(page).getByRole('button', { name: 'Alle eröffnen' });

test('a balance that is no ±HH:MM marks and focuses its field and sends nothing', async ({ page }) => {
  await balanceOf(page, 'Anna Anfang').fill('+12:30');
  await balanceOf(page, 'Bernd Beginn').fill('750');
  await openAll(page).click();

  await expect(balanceOf(page, 'Bernd Beginn')).toBeFocused();
  await expect(balanceOf(page, 'Bernd Beginn')).toHaveAttribute('aria-invalid', 'true');
  await expect(balanceOf(page, 'Anna Anfang')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form(page)).toContainText('Gib den Saldo als Std:Min an, etwa +12:30 oder -3:15.');
  await expect(openAll(page)).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);

  // One person's own button checks only that person's balance.
  await openOne(page, 'Anna Anfang').click();
  await expectHeldWrite(page, 'open-time-accounts');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({
    openedOn: '2026-09-01',
    reason: 'Einführung des Zeitkontos',
    openings: [{ employeeRecordId: 'contract-missing-anna', openingBalance: '+12:30' }],
  });
});

async function submitAll(page: Page): Promise<void> {
  await balanceOf(page, 'Anna Anfang').fill('+12:30');
  await balanceOf(page, 'Bernd Beginn').fill('-3:15');
  await openAll(page).click();
  await expect(openAll(page)).toBeDisabled();
  await expect(openAll(page)).toHaveAttribute('aria-busy', 'true');
  await expect(openOne(page, 'Anna Anfang')).toBeDisabled();
  await expectHeldWrite(page, 'open-time-accounts');
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test('„Alle eröffnen“ is busy in its first frame and sends every person in one write', async ({ page }) => {
  await submitAll(page);
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({
    openedOn: '2026-09-01',
    reason: 'Einführung des Zeitkontos',
    openings: [
      { employeeRecordId: 'contract-missing-anna', openingBalance: '+12:30' },
      { employeeRecordId: 'contract-missing-bernd', openingBalance: '-3:15' },
    ],
  });
  await answerHeldWrite(page, null);
  await expect(page.getByRole('alert')).toContainText('2 Zeitkonten sind eröffnet.');
  await expect(textInDom(page, 'Alle Zeitkonten sind eröffnet.')).toBeVisible();
});

test('a refused opening stays at the form with the typed balances', async ({ page }) => {
  await submitAll(page);
  await answerHeldWrite(page, 'opening_date_locked');
  await expect(page.getByRole('alert')).toContainText(
    'Ein abgeschlossener Monat endet an oder nach diesem Datum.',
  );
  await expect(balanceOf(page, 'Anna Anfang')).toHaveValue('+12:30');
  await expect(balanceOf(page, 'Bernd Beginn')).toHaveValue('-3:15');
  await expect(openAll(page)).toBeEnabled();
});

test('Enter in a balance opens only that person, and Enter in the reason opens nobody', async ({ page }) => {
  const reason = form(page).getByRole('textbox', { name: 'Grund', exact: true });
  await reason.press('Enter');
  expect(await page.evaluate(() => window.uiContractWrites.calls.length)).toBe(0);

  await balanceOf(page, 'Bernd Beginn').fill('-3:15');
  await balanceOf(page, 'Bernd Beginn').press('Enter');
  await expect(openOne(page, 'Bernd Beginn')).toHaveAttribute('aria-busy', 'true');
  await expect(openAll(page)).toBeDisabled();
  await expectHeldWrite(page, 'open-time-accounts');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual({
    openedOn: '2026-09-01',
    reason: 'Einführung des Zeitkontos',
    openings: [{ employeeRecordId: 'contract-missing-bernd', openingBalance: '-3:15' }],
  });
});

test('a marked reason clears as soon as it is typed again', async ({ page }) => {
  const reason = form(page).getByRole('textbox', { name: 'Grund', exact: true });
  await reason.fill('');
  await openAll(page).click();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await reason.fill('Einführung');
  await expect(reason).not.toHaveAttribute('aria-invalid', 'true');
  await expect(form(page)).not.toContainText('Gib einen Grund für die Eröffnung an.');
});
