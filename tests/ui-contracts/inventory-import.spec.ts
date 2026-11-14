import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ImportRowOutcome } from '../../lib/inventory/csv-import';
import { openContractFixture } from './open-fixture';

// werk-flow/werkflow-planning#371: the CSV import previews before it books.
// The preview and the result show the file and the mode the preview was made
// from, the result lists every row with a note, and going back to the mapping
// checks the file for a repeat again.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'inventory-import');
});

function booked(index: number): ImportRowOutcome {
  return {
    index,
    outcome: 'booked',
    matchedBy: null,
    itemName: `Pressfitting ${index}`,
    unit: 'piece',
    locationName: 'Hauptlager',
    locationCreated: false,
    quantity: 1,
    quantityAfter: 1,
    reason: null,
    itemUnit: null,
  };
}

function rejectedUnit(index: number): ImportRowOutcome {
  return {
    ...booked(index),
    outcome: 'rejected',
    reason: 'unknown_unit',
    itemName: null,
    quantityAfter: null,
  };
}

async function setContract(page: Page, values: Partial<Window['uiContractImport']>): Promise<void> {
  await page.evaluate((next) => Object.assign(window.uiContractImport, next), values);
}

/** Opens the dialog and chooses a synthetic file of `rows` rows; the last one carries an unknown unit. */
async function chooseFile(page: Page, rows: number): Promise<Locator> {
  await page.getByRole('button', { name: 'CSV importieren', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'CSV importieren', exact: true });
  const lines = Array.from({ length: rows }, (_, index) =>
    index === rows - 1
      ? `Pressfitting ${index};Fass;1;Hauptlager`
      : `Pressfitting ${index};Stück;1;Hauptlager`,
  );
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'nordrohr.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(['Artikelname;Einheit;Bestand;Lager', ...lines].join('\n')),
  });
  await expect(dialog.locator('[data-import-repeat-check="clear"]')).toBeVisible();
  return dialog;
}

test('the result lists the rejected row even after more than a hundred accepted rows', async ({ page }) => {
  const outcomes = [...Array.from({ length: 101 }, (_, index) => booked(index)), rejectedUnit(101)];
  await setContract(page, { previewRows: outcomes });
  const dialog = await chooseFile(page, 102);
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Jetzt buchen', exact: true }).click();
  await expect(dialog.getByText('Unbekannte Einheit: „Fass“.', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Pressfitting 0', { exact: true })).toHaveCount(0);
});

test('a mode changed while the preview loads leaves the preview and its mode together', async ({ page }) => {
  await setContract(page, { previewRows: [booked(0), rejectedUnit(1)], holdPreview: true });
  const dialog = await chooseFile(page, 2);
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractImport.releasePreview !== null)).toBe(true);
  await dialog.getByRole('checkbox', { name: /Nur Stammdaten und Preise/ }).click();
  await page.evaluate(() => window.uiContractImport.releasePreview?.());
  await expect(dialog.getByText('+1 Stück in Hauptlager, danach 1 Stück', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Nur Stammdaten und Preise: Es wird kein Bestand gebucht.')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractImport.previewModes)).toEqual(['stock']);
});

test('going back to the mapping after a failed booking checks the file for a repeat again', async ({
  page,
}) => {
  await setContract(page, { previewRows: [booked(0), rejectedUnit(1)], bookFails: true });
  const dialog = await chooseFile(page, 2);
  await dialog.getByRole('button', { name: 'Vorschau anzeigen', exact: true }).click();
  await dialog.getByRole('button', { name: 'Jetzt buchen', exact: true }).click();
  await expect(
    dialog.getByText('Der Import konnte nicht gebucht werden. Versuch es noch einmal.'),
  ).toBeVisible();
  // The failed answer may have hidden a booking that went through.
  await setContract(page, {
    repeatAnswer: { bookedAt: '2026-11-12T08:15:00.000Z', bookedBy: 'Bruno Büro' },
  });
  await dialog.getByRole('button', { name: 'Zurück zur Zuordnung', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Trotzdem fortfahren', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.uiContractImport.repeatChecks)).toBe(2);
});
