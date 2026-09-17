import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/workspace-test-lock';

for (const pauseBeforeSettle of [false, true]) {
test(`events during a pending route render queue one follow-up${pauseBeforeSettle ? ' after re-enabling' : ''}`, async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through the UI contract runner');
  await page.clock.install({ time: new Date('2026-09-08T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-08T10:00:01Z'));
  const url = 'http://localhost/ui-contracts';
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<html lang="de"><body><div id="root"></div></body></html>' }));
  await page.goto(url);
  await page.evaluate(() => { window.uiContractFixture = 'route-refresh'; });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByLabel('Serverstand')).toHaveText('vorher');
  await page.evaluate(() => window.calendarContract.system({ extension: 'postgres_changes', status: 'ok' }));
  await page.clock.runFor(151);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh']);
  await page.evaluate(() => { window.calendarContract.emit('clients'); window.calendarContract.emit('clients'); });
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh']);
  await expect(page.getByLabel('Serverstand')).toHaveText('vorher');
  if (pauseBeforeSettle) await page.getByRole('button', { name: 'Aktualisierung pausieren' }).click();
  await page.evaluate(() => window.routeRefreshContract.complete(0, 'erster neuer Stand'));
  await expect(page.getByLabel('Serverstand')).toHaveText('erster neuer Stand');
  if (pauseBeforeSettle) {
    await page.clock.runFor(1_100);
    expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh']);
    await page.getByRole('button', { name: 'Aktualisierung fortsetzen' }).click();
  }
  await page.clock.runFor(151);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh', 'refresh']);
  await page.evaluate(() => window.routeRefreshContract.complete(1, 'nach allen Änderungen'));
  await expect(page.getByLabel('Serverstand')).toHaveText('nach allen Änderungen');
  await page.clock.runFor(1_100);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toEqual(['refresh', 'refresh']);
});
}
