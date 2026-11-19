import { expect, test } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// werk-flow/werkflow-planning#375: the office makes a wholesaler's catalog
// article its own from the material dialog. A running adopt and its failure
// stay in view at their action, even when the search is shortened below the
// catalog search's three characters meanwhile. Made-up data only.

test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'supplier-catalog');
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
});

test('a running adopt and its failure stay visible after the search drops below three characters', async ({
  page,
}) => {
  const search = page.getByRole('textbox', { name: 'Material suchen' });
  await search.fill('Kupfer');
  await page.getByRole('button', { name: /Kupferrohr 15 mm hart/ }).click();
  const pending = page
    .getByRole('status')
    .filter({ hasText: 'Der Katalogartikel wird als eigener Artikel angelegt …' });
  await expect(pending).toBeVisible();

  await search.fill('Ku');
  await expect(
    page.getByRole('main').getByText('Ab drei Zeichen sucht die Suche auch in den Großhandelskatalogen.'),
  ).toBeVisible();
  await expect(pending).toBeVisible();

  await page.evaluate(() => window.uiContractSupplierCatalog.refuseAdopt?.());
  await expect(pending).toHaveCount(0);
  await expect(
    page.getByRole('main').getByText('Diesen Katalogartikel gibt es nicht mehr. Suche noch einmal.'),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uiContractSupplierCatalog.adopted)).toEqual([
    '37500000-0000-4000-8000-000000000071',
  ]);
});
