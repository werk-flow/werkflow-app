import { dayJobBlock, resizeJob } from './day-view-support';
import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/workspace-test-lock';

// This supplies only geometry utilities for the isolated fixture, not application behavior.
const geometry = `.relative{position:relative}.absolute{position:absolute}.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.h-full{height:100%}.w-full{width:100%}.overflow-x-auto{overflow-x:auto}.overflow-hidden{overflow:hidden}.min-w-0{min-width:0}.min-h-0{min-height:0}.top-0{top:0}.right-0{right:0}.left-0{left:0}.w-1\\.5{width:6px}.z-20{z-index:20}.z-10{z-index:10}`;

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.route('http://localhost/ui-contracts', route => route.fulfill({ contentType: 'text/html', body: `<html lang="de"><head><style>${geometry}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => { window.uiContractFixture = 'day-view'; });
  await page.addScriptTag({ path: bundle });
  await expect(dayJobBlock(page)).toBeVisible();
});


test('real day-view drag waits for persistence and releases refresh ownership after transport rejection', async ({ page }) => {
  await resizeJob(page);
  await expect(page.getByLabel('Laufende Speicherung')).toHaveText('aktiv');
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').getByText('Auftrag wurde geändert.', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dayViewContract.complete(0, 'reject'));
  await expect(page.getByRole('alert').getByText('Auftrag konnte nicht geändert werden.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Laufende Speicherung')).toHaveText('frei');
  await expect.poll(() => page.evaluate(() => window.calendarContract.reads.length)).toBeGreaterThan(0);
});

test('real day-view confirmed save exposes Undo, whose returned failure is visible and releases ownership', async ({ page }) => {
  await resizeJob(page);
  await expect(page.getByRole('button', { name: 'Rückgängig', exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dayViewContract.complete(0, 'success'));
  await expect(page.getByRole('alert').getByText('Auftrag wurde geändert.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Rückgängig', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.dayViewContract.calls.length)).toBe(2);
  await expect(page.getByLabel('Laufende Speicherung')).toHaveText('aktiv');
  expect(await page.evaluate(() => window.dayViewContract.calls[1]?.input.estimatedDurationMinutes)).toBe(60);
  await page.evaluate(() => window.dayViewContract.complete(1, 'failure'));
  await expect(page.getByRole('alert').getByText('Die Aktion konnte nicht rückgängig gemacht werden.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Laufende Speicherung')).toHaveText('frei');
  await expect.poll(() => page.evaluate(() => window.calendarContract.reads.length)).toBeGreaterThan(0);
});
