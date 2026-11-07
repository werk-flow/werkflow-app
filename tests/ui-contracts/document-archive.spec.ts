import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.clock.install({ time: new Date('2026-11-07T10:00:00Z') });
  const url = 'http://localhost/ui-contracts';
  await page.route(url, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(url);
  await page.evaluate(() => {
    window.uiContractFixture = 'document-archive';
  });
  await page.addScriptTag({ path: bundle });
});

function documentDate(page: Page) {
  return page.getByRole('group', { name: 'Belegdatum der Datei' });
}

function retentionWrites(page: Page) {
  return page.evaluate(() => window.documentArchiveContract.writes);
}

test('a typed document date stays a draft until it is saved', async ({ page }) => {
  const picker = documentDate(page);
  // A lone day digit, and a year left after a typing pause and a blur.
  await picker.locator('[data-segment="day"]').click();
  await page.keyboard.type('1');
  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('20');
  await page.clock.runFor(1000);
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  expect(await retentionWrites(page)).toEqual([]);

  await picker.locator('[data-segment="year"]').click();
  await page.keyboard.type('2025');
  expect(await retentionWrites(page)).toEqual([]);
  await page.getByRole('button', { name: 'Belegdatum speichern' }).click();
  expect(await retentionWrites(page)).toEqual([{ documentDate: '2025-03-01', retentionClass: 'ten_years' }]);
  await expect(page.getByRole('button', { name: 'Belegdatum speichern' })).toHaveCount(0);
  await expect(picker).toHaveText(/01\.03\.2025/);
});
