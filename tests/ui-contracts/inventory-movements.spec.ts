import { expect, test, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The empty movement history of /inventar (docs/features/inventory.md,
// "Movement history"): an organization that has booked nothing says so and
// offers nothing to reset; a search without matches says that the filters
// match nothing and offers to reset them.

const NO_HISTORY = 'Noch keine Bewegungen';
const NO_MATCH = 'Keine Bewegungen gefunden';
const RESET = 'Filter zurücksetzen';

async function openMovementsFixture(page: Page): Promise<void> {
  await openContractFixture(page, 'inventory-movements');
  const css = process.env.WERKFLOW_UI_CONTRACT_CSS;
  if (!css) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.addStyleTag({ path: css });
}

test('an organization without movements says so and offers no reset; a search without matches offers it', async ({
  page,
}) => {
  await openMovementsFixture(page);
  const empty = page.getByRole('region', { name: 'Bewegungen ohne Verlauf' });
  await expect(empty.getByText(NO_HISTORY)).toBeVisible();
  await expect(empty.getByRole('button', { name: RESET })).toHaveCount(0);
  await expect(empty.getByText(NO_MATCH)).toHaveCount(0);

  const filtered = page.getByRole('region', { name: 'Bewegungen ohne Treffer' });
  await expect(filtered.getByText(NO_MATCH)).toBeVisible();
  await filtered.getByRole('button', { name: RESET }).click();
  expect(await page.evaluate(() => window.uiContractInventoryHistoryResets)).toBe(1);
});

test('captures of the empty history, phone and desktop, light and dark', async ({ page }) => {
  for (const width of [1280, 375]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await openMovementsFixture(page);
      const empty = page.getByRole('region', { name: 'Bewegungen ohne Verlauf' });
      await expect(empty.getByText(NO_HISTORY)).toBeVisible();
      await empty.screenshot({ path: test.info().outputPath(`empty-history-${width}-${colorScheme}.png`) });
    }
  }
});
