import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.clock.install({ time: new Date('2026-09-08T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-08T10:00:01Z'));
  const url = 'http://localhost/ui-contracts';
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="de"><body><div id="root"></div></body></html>' }));
  await page.goto(url);
  await page.evaluate(() => { window.uiContractFixture = 'options'; });
  await page.addScriptTag({ path: bundle });
});

test('global choices load another page and preserve selection through another search', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Kunden' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(1);
  await page.evaluate(() => window.optionContract.resolve(0, [{ value: 'first', label: 'Erster Kunde' }], [], true));
  await page.getByRole('button', { name: 'Weitere Ergebnisse laden' }).click();
  await page.clock.runFor(1);
  await expect.poll(() => page.evaluate(() => window.optionContract.requests[1]?.offset)).toBe(50);
  await page.evaluate(() => window.optionContract.resolve(1, [{ value: 'second', label: 'Kunde außerhalb der Listenseite' }]));
  await page.getByRole('option', { name: 'Kunde außerhalb der Listenseite' }).click();
  await expect(page.getByLabel('Auswahl')).toHaveText('second');
  await page.getByRole('textbox', { name: 'Suchen...' }).fill('anderer');
  await page.clock.runFor(151);
  const index = await page.evaluate(() => window.optionContract.requests.length - 1);
  expect(await page.evaluate((index) => window.optionContract.requests[index]?.selectedIds, index)).toEqual(['second']);
  await page.evaluate((index) => window.optionContract.resolve(index, [], [{ value: 'second', label: 'Kunde außerhalb der Listenseite' }]), index);
  await expect(page.getByLabel('Auswahl')).toHaveText('second');
});

test('obsolete search and old organization responses cannot replace current choices', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Kunden' }).click();
  await page.clock.runFor(1);
  await page.getByRole('textbox', { name: 'Suchen...' }).fill('neu');
  await page.clock.runFor(151);
  await expect.poll(() => page.evaluate(() => window.optionContract.requests.length)).toBe(2);
  await page.evaluate(() => window.optionContract.resolve(1, [{ value: 'new', label: 'Neuer Kunde' }]));
  await page.evaluate(() => window.optionContract.resolve(0, [{ value: 'old', label: 'Alter Kunde' }]));
  await expect(page.getByRole('option', { name: 'Neuer Kunde' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Organisation wechseln' }).click();
  await page.clock.runFor(151);
  await page.getByRole('combobox', { name: 'Kunden' }).click();
  await page.clock.runFor(1);
  await expect(page.getByRole('option', { name: 'Neuer Kunde' })).toHaveCount(0);
});
