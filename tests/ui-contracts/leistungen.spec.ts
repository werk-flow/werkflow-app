import { expect, test, type Page } from '@playwright/test';
import { visibleText } from '../golden/support/steps/shared';
import { openContractFixture } from './open-fixture';

// The Leistungen list (docs/features/commercial-and-finance.md): a phone card
// shows the description the desktop row shows, a saved price closes its dialog
// while a refused one keeps it with the typed values and the reason, and
// „Leistung anlegen“ is offered only while the list that holds its dialog is
// loaded.

const DESCRIPTION = 'Geselle, je angefangene Viertelstunde';
const PRICE_DIALOG = 'Preise von „Arbeitszeit Monteur“';
const SAVE_FAILED = 'Die Leistung konnte nicht gespeichert werden. Bitte versuche es erneut.';

async function openLeistungenFixture(page: Page): Promise<void> {
  await openContractFixture(page, 'leistungen');
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
}

async function openPrices(page: Page) {
  await page.getByRole('button', { name: 'Arbeitszeit Monteur', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: PRICE_DIALOG });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a phone card shows the description its desktop row shows', async ({ page }) => {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await openLeistungenFixture(page);
    await expect(visibleText(page, DESCRIPTION, true)).toBeVisible();
  }
});

test('a refused price keeps the dialog with the typed price and the reason; a saved price closes it', async ({
  page,
}) => {
  await openLeistungenFixture(page);
  await page.evaluate(() => {
    window.uiContractLeistungen.refusePrice = true;
  });
  const dialog = await openPrices(page);
  const salePrice = dialog.getByLabel('Verkaufspreis');
  await salePrice.fill('72,50');
  await dialog.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect(dialog.getByText(SAVE_FAILED)).toBeVisible();
  await expect(salePrice).toHaveValue('72,50');

  await page.evaluate(() => {
    window.uiContractLeistungen.refusePrice = false;
  });
  await dialog.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractLeistungen.savedPrices)).toEqual(['monteur 72,50']);
});

test('„Leistung anlegen“ is hidden while the list failed to load and opens its dialog once the list loads', async ({
  page,
}) => {
  await openLeistungenFixture(page);
  const create = page.getByRole('button', { name: 'Leistung anlegen', exact: true });
  const list = page.getByRole('region', { name: 'Liste' });
  await expect(list.getByText('Leistungen konnten nicht geladen werden')).toBeVisible();
  await expect(create).toHaveCount(0);

  await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
  await create.click();
  await expect(list.getByLabel('Anlegen-Dialog')).toHaveText('offen');
});
