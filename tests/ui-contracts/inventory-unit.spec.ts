import { expect, test, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The unit list in the catalog (docs/features/inventory.md, "Units"): an
// article saved before the list with a unit outside it shows „Einheit
// prüfen“, and its form marks the unit and refuses the save until a unit
// from the list is chosen.

const LEGACY = 'Bogen 90° 15 mm';
const LISTED = 'Kupferrohr 15 mm';
const UNIT_ERROR = '„Bogen“ ist keine Einheit aus der Liste. Bitte wähle eine Einheit aus.';

async function openUnitFixture(page: Page): Promise<void> {
  await openContractFixture(page, 'inventory-unit');
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
}

async function submitLegacyArticle(page: Page) {
  await page.getByRole('button', { name: 'Artikel bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Artikel bearbeiten' });
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  return dialog;
}

const saves = (page: Page) => page.evaluate(() => window.uiContractInventorySaves);

test('only an article with a unit outside the list shows „Einheit prüfen“, on its card and its row', async ({
  page,
}) => {
  await openUnitFixture(page);
  for (const prefix of ['Karte', 'Zeile']) {
    await expect(page.getByLabel(`${prefix} ${LEGACY}`).getByText('Einheit prüfen')).toBeVisible();
    await expect(page.getByLabel(`${prefix} ${LISTED}`).getByText('Einheit prüfen')).toHaveCount(0);
  }
});

test('the form marks a unit outside the list, focuses it and saves only after a listed unit is chosen', async ({
  page,
}) => {
  await openUnitFixture(page);
  const dialog = await submitLegacyArticle(page);
  const unit = dialog.locator('#inventory-item-unit');
  await expect(dialog.getByText(UNIT_ERROR)).toBeVisible();
  await expect(unit).toBeFocused();
  await expect(unit).toHaveAttribute('aria-invalid', 'true');
  expect(await saves(page)).toEqual([]);

  await unit.click();
  await page.getByRole('option', { name: 'Stück', exact: true }).click();
  await expect(dialog.getByText(UNIT_ERROR)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  expect(await saves(page)).toEqual(['piece']);
});

test('captures of the marked catalog row and form, phone and desktop, light and dark', async ({ page }) => {
  for (const width of [1280, 375]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await openUnitFixture(page);
      await expect(page.getByLabel(`Karte ${LEGACY}`).getByText('Einheit prüfen')).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`catalog-${width}-${colorScheme}.png`),
        fullPage: true,
      });
      const dialog = await submitLegacyArticle(page);
      await expect(dialog.getByText(UNIT_ERROR)).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`form-${width}-${colorScheme}.png`) });
    }
  }
});
