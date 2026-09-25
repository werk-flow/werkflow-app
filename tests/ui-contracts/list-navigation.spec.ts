import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/workspace-test-lock';
import { textInDom } from '../golden/support/steps/shared';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.clock.install({ time: new Date('2026-09-08T10:00:00Z') });
  await page.clock.pauseAt(new Date('2026-09-08T10:00:01Z'));
  await page.route('http://localhost/ui-contracts**', (route) => route.fulfill({ contentType: 'text/html', body: '<html lang="de"><body><div id="root"></div></body></html>' }));
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => { window.uiContractFixture = 'list-navigation'; });
  await page.addScriptTag({ path: bundle });
});

test('completed pagination does not become pending again after another control changes the URL', async ({ page }) => {
  await page.getByRole('button', { name: 'Zweite Seite laden' }).click();
  await expect(page.getByLabel('Listenstatus')).toHaveText('Wird geladen');
  await page.evaluate(() => {
    const [firstRequest] = window.listNavigationContract.requests;
    if (!firstRequest) throw new Error('expected a recorded list navigation request');
    window.listNavigationContract.commit(firstRequest);
  });
  await expect(page.getByLabel('Listenstatus')).toHaveText('Bereit');
  await page.evaluate(() => window.listNavigationContract.commit('/ui-contracts?view=work'));
  await expect(page.getByLabel('Listenstatus')).toHaveText('Bereit');
  await page.clock.runFor(15_001);
  await expect(textInDom(page, 'Die Liste wurde noch nicht aktualisiert. Bitte aktualisiere die Seite.')).toHaveCount(0);
});

test('rapid searches retain the latest request across an intermediate URL commit', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Liste durchsuchen' }).fill('alt');
  await page.clock.runFor(251);
  await page.getByRole('textbox', { name: 'Liste durchsuchen' }).fill('neu');
  await page.clock.runFor(251);
  await page.evaluate(() => {
    const [firstRequest] = window.listNavigationContract.requests;
    if (!firstRequest) throw new Error('expected a recorded list navigation request');
    window.listNavigationContract.commit(firstRequest);
  });
  await expect(page.getByLabel('Listenstatus')).toHaveText('Wird geladen');
  await page.evaluate(() => {
    const secondRequest = window.listNavigationContract.requests[1];
    if (!secondRequest) throw new Error('expected a second recorded list navigation request');
    window.listNavigationContract.commit(secondRequest);
  });
  await expect(page.getByLabel('Listenstatus')).toHaveText('Bereit');
  await expect.poll(() => page.evaluate(() => location.search)).toContain('q=neu');
});

test('history navigation cancels a queued search and new pagination uses that URL', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Liste durchsuchen' }).fill('verwerfen');
  await page.evaluate(() => window.listNavigationContract.commit('/ui-contracts?view=folders', true));
  await expect(page.getByLabel('Listenstatus')).toHaveText('Bereit');
  await page.clock.runFor(251);
  expect(await page.evaluate(() => window.listNavigationContract.requests.length)).toBe(0);
  await page.getByRole('button', { name: 'Zweite Seite laden' }).click();
  expect(await page.evaluate(() => window.listNavigationContract.requests[0])).toBe('/ui-contracts?view=folders&page=2');
});

test('another control replaces an unfinished request and cancels its queued follow-up', async ({ page }) => {
  await page.getByRole('button', { name: 'Zweite Seite laden' }).click();
  await expect(page.getByLabel('Listenstatus')).toHaveText('Wird geladen');
  await page.getByRole('textbox', { name: 'Liste durchsuchen' }).fill('verwerfen');
  await page.evaluate(() => window.listNavigationContract.commit('/ui-contracts?view=work'));
  await expect(page.getByLabel('Listenstatus')).toHaveText('Bereit');
  await page.clock.runFor(15_001);
  expect(await page.evaluate(() => window.listNavigationContract.requests.length)).toBe(1);
  await expect(textInDom(page, 'Die Liste wurde noch nicht aktualisiert. Bitte aktualisiere die Seite.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Zweite Seite laden' }).click();
  expect(await page.evaluate(() => window.listNavigationContract.requests[1])).toBe('/ui-contracts?view=work&page=2');
});

test('pager retains a distinct count announcement and truthful loading feedback while a page is pending', async ({ page }) => {
  const pager = page.getByRole('navigation', { name: 'Testliste', exact: true });
  const count = pager.getByRole('status', { name: 'Eintragsanzahl', exact: true });
  await expect(count).toHaveText('1–50 von 61');
  await pager.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(pager.getByRole('status', { name: 'Liste wird geladen', exact: true })).toBeVisible();
  await expect(count).toHaveCount(1);
  await expect(count).toHaveText('1–50 von 61');
  await expect(count.getByRole('status')).toHaveCount(0);
  await expect(pager.getByRole('status', { name: 'Wird gespeichert', exact: true })).toHaveCount(0);
  await expect(pager.getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled();
  await expect(pager.getByRole('button', { name: 'Zurück', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    const [firstRequest] = window.listNavigationContract.requests;
    if (!firstRequest) throw new Error('expected a recorded list navigation request');
    window.listNavigationContract.commit(firstRequest);
  });
  await expect(count).toHaveText('51–61 von 61');
  await expect(pager.getByRole('status', { name: 'Liste wird geladen', exact: true })).toHaveCount(0);
  await expect(pager.getByRole('button', { name: 'Zurück', exact: true })).toBeEnabled();
  await expect(pager.getByRole('button', { name: 'Weiter', exact: true })).toBeDisabled();
});
