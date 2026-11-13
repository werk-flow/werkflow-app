import { expect, test, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// An article's suppliers and dated prices in the article dialog
// (docs/features/inventory.md, "Suppliers", "Prices", "Article dialog"): the
// pack reads as a sentence before it saves, a new price carries its price
// quantity and first day, an article without terms says so, and a failed read
// offers „Erneut laden“ in its tab.

async function openArticle(page: Page, label: string) {
  await openContractFixture(page, 'article-terms');
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Artikel bearbeiten' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const writes = (page: Page) => page.evaluate(() => window.uiContractArticleTermsWrites);

test('the suppliers tab marks the preferred supplier and reads each pack as a sentence', async ({ page }) => {
  const dialog = await openArticle(page, 'Artikel mit Preisen');
  await dialog.getByRole('tab', { name: 'Lieferanten', exact: true }).click();
  await expect(dialog.getByText('Art.-Nr. NR-1601 · 1 Bund = 25 Meter')).toBeVisible();
  await expect(dialog.getByText('Art.-Nr. SR-77-16 · 1 Rolle = 50 Meter')).toBeVisible();
  await expect(dialog.getByText('Bevorzugt', { exact: true })).toHaveCount(1);
});

test('a pack of 0 is refused at its field, and a valid pack saves as the sentence said', async ({ page }) => {
  const dialog = await openArticle(page, 'Artikel mit Preisen');
  await dialog.getByRole('tab', { name: 'Lieferanten', exact: true }).click();
  await dialog
    .getByRole('listitem')
    .filter({ hasText: 'Großhandel Nordrohr' })
    .getByRole('button', { name: 'Bearbeiten', exact: true })
    .click();
  const supplier = page.getByRole('dialog', { name: 'Lieferant bearbeiten' });
  await expect(supplier.getByText('Umrechnung: 1 Bund = 25 Meter.')).toBeVisible();
  const base = supplier.locator('#article-supplier-base-quantity');
  await base.fill('0');
  await supplier.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(base).toBeFocused();
  await expect(base).toHaveAttribute('aria-invalid', 'true');
  expect(await writes(page)).toEqual([]);

  await base.fill('12,5');
  await expect(supplier.getByText('Umrechnung: 1 Bund = 12,5 Meter.')).toBeVisible();
  await supplier.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(supplier).toHaveCount(0);
  expect(await writes(page)).toEqual([
    {
      write: 'saveSupplier',
      input: {
        itemId: 'filled',
        unit: 'meter',
        referenceId: 'ref-nord',
        supplierId: 'nordrohr',
        supplierName: null,
        supplierArticleNumber: 'NR-1601',
        purchaseUnit: 'bundle',
        packQuantity: 1,
        baseQuantity: 12.5,
        isPreferred: true,
      },
    },
  ]);
});

test('the prices tab shows today’s prices with day and source, and a new price keeps its price quantity', async ({
  page,
}) => {
  const dialog = await openArticle(page, 'Artikel mit Preisen');
  await dialog.getByRole('tab', { name: 'Preise', exact: true }).click();
  const current = dialog.getByRole('region', { name: 'Aktuelle Preise' });
  await expect(current.getByText('412,00 € je 100 m')).toBeVisible();
  await expect(current.getByText('Gilt seit 01.07.2026 · CSV-Import')).toBeVisible();
  await expect(current.getByText('64,90 € je 10 m')).toBeVisible();

  await dialog.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect(dialog.locator('#article-price-amount')).toBeFocused();
  expect(await writes(page)).toEqual([]);

  await dialog.locator('#article-price-amount').fill('418,50');
  await dialog.locator('#article-price-quantity').click();
  await page.getByRole('option', { name: '100 m', exact: true }).click();
  await dialog.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect(dialog.locator('#article-price-amount')).toHaveValue('');
  expect(await writes(page)).toEqual([
    {
      write: 'addPrice',
      input: {
        itemId: 'filled',
        unit: 'meter',
        kind: 'purchase',
        amountCents: 41850,
        priceQuantity: 100,
        validFrom: '2026-11-13',
      },
    },
  ]);
});

test('an edit made while a price saves stays in the form', async ({ page }) => {
  const dialog = await openArticle(page, 'Artikel mit Preisen');
  await dialog.getByRole('tab', { name: 'Preise', exact: true }).click();
  await page.evaluate(() => {
    window.uiContractArticleTermsHoldPrice = true;
  });
  await dialog.locator('#article-price-amount').fill('418,50');
  await dialog.getByRole('button', { name: 'Preis speichern', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractArticleTermsReleasePrice !== null)).toBe(true);
  await dialog.locator('#article-price-amount').fill('420,00');
  await page.evaluate(() => window.uiContractArticleTermsReleasePrice?.());
  await expect(dialog.locator('#article-price-amount')).toHaveValue('420,00');
  expect(await writes(page)).toHaveLength(1);
});

test('an article without suppliers or prices says so in each tab', async ({ page }) => {
  const dialog = await openArticle(page, 'Artikel ohne Preise');
  await dialog.getByRole('tab', { name: 'Lieferanten', exact: true }).click();
  await expect(dialog.getByText('Noch kein Lieferant hinterlegt.')).toBeVisible();
  await dialog.getByRole('tab', { name: 'Preise', exact: true }).click();
  await expect(dialog.getByText('Noch kein Preis erfasst.')).toBeVisible();
  await expect(dialog.getByText('Kein Preis für heute.')).toHaveCount(2);
});

test('a failed read of the terms offers „Erneut laden“ in each tab, and the master data stay usable', async ({
  page,
}) => {
  const dialog = await openArticle(page, 'Artikel mit Lesefehler');
  await expect(dialog.getByRole('button', { name: 'Speichern', exact: true })).toBeEnabled();
  for (const tab of ['Lieferanten', 'Preise']) {
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    const retry = dialog.getByRole('button', { name: 'Erneut laden', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
  }
  // The retry re-reads the route, through the shared navigation stand-in (service-boundaries.ts).
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh', 'refresh']);
});

// Captures of the tabs: filled, empty and failed, phone and desktop, light and dark.
const SHOTS = [
  [
    'Artikel mit Preisen',
    [
      ['Lieferanten', 'lieferanten'],
      ['Preise', 'preise'],
    ],
  ],
  [
    'Artikel ohne Preise',
    [
      ['Lieferanten', 'lieferanten-leer'],
      ['Preise', 'preise-leer'],
    ],
  ],
  ['Artikel mit Lesefehler', [['Preise', 'preise-fehler']]],
] as const;

for (const width of [1280, 375]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`captures of the tabs at ${width} px, ${colorScheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      for (const [label, tabs] of SHOTS) {
        const dialog = await openArticle(page, label);
        for (const [tab, name] of tabs) {
          const trigger = dialog.getByRole('tab', { name: tab, exact: true });
          await trigger.click();
          await expect(trigger).toHaveAttribute('data-state', 'active');
          await page.screenshot({ path: test.info().outputPath(`${name}-${width}-${colorScheme}.png`) });
        }
      }
    });
  }
}
