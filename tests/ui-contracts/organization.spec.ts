import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'organization';
  });
  await page.addScriptTag({ path: bundle });
});

/**
 * Answers the switch's cookie write once it is pending: the switch wipes the device's day first
 * (decision record 0010, "Device data"), so the write starts only after that wipe.
 */
async function finishCookieWrite(page: Page, writes: number, success: boolean): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.organizationContract.writes.length)).toBe(writes);
  await page.evaluate((ok) => window.organizationContract.finishCookie(ok), success);
}

test('organization readers keep the confirmed cookie scope until a held switch commits', async ({ page }) => {
  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await expect(page.getByLabel('Wechselstatus')).toHaveText('Wird gewechselt');
  await expect(page.getByLabel('Aktive Organisation')).toHaveText('organization-one');
  expect(await page.evaluate(() => window.organizationContract.navigations)).toEqual([]);
  await finishCookieWrite(page, 1, true);
  await expect(page.getByLabel('Aktive Organisation')).toHaveText('organization-two');
  expect(await page.evaluate(() => window.organizationContract.reads)).toEqual([
    { organizationId: 'organization-one', cookie: 'organization-one' },
    { organizationId: 'organization-two', cookie: 'organization-two' },
  ]);
  await expect(page.getByLabel('Wechselstatus')).toHaveText('Wird gewechselt');
  await page.getByRole('button', { name: 'Serverdaten übernehmen' }).click();
  await expect(page.getByLabel('Wechselstatus')).toHaveText('Bereit');
});

test('a rejected organization switch retains the current scope and can recover', async ({ page }) => {
  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await finishCookieWrite(page, 1, false);
  await expect(page.getByLabel('Wechselstatus')).toHaveText('Bereit');
  await expect(page.getByLabel('Aktive Organisation')).toHaveText('organization-one');
  await expect(page.getByRole('alert')).toContainText('Die Organisation konnte nicht gewechselt werden.');
  expect(await page.evaluate(() => window.organizationContract.navigations)).toEqual([]);
  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await finishCookieWrite(page, 2, true);
  await expect(page.getByLabel('Aktive Organisation')).toHaveText('organization-two');
  await page.getByRole('button', { name: 'Serverdaten übernehmen' }).click();
  await expect(page.getByLabel('Wechselstatus')).toHaveText('Bereit');
});

/** Answers the oldest held save once its code waits for the answer, and waits until that code ran. */
async function answerSave(page: Page, answered: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.organizationContract.pendingSaves.length)).toBe(1);
  await page.evaluate(() => window.organizationContract.pendingSaves.shift()?.());
  await expect.poll(() => page.evaluate(() => window.organizationContract.answeredSaves)).toBe(answered);
}

/** Records the text of every banner that renders from now on, also one that is replaced at once. */
async function recordBanners(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const shown = window.organizationContract.shownBanners;
    new MutationObserver(() => {
      for (const alert of document.querySelectorAll('[data-banner-id]')) {
        const text = alert.textContent ?? '';
        if (!shown.includes(text)) shown.push(text);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => window.organizationContract.shownBanners.slice());
}

test("a switch starts the page's state fresh with the new server props and drops the old page's late feedback", async ({
  page,
}) => {
  const shownBanners = await recordBanners(page);
  const draft = page.getByLabel('Entwurf');
  await draft.fill('Notiz der ersten Organisation');
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await finishCookieWrite(page, 1, true);
  // Until the new organization's server props arrive, the page still shows the first one's state.
  await expect(draft).toHaveValue('Notiz der ersten Organisation');
  await page.getByRole('button', { name: 'Serverdaten übernehmen' }).click();
  await expect(draft).toHaveValue('');
  await answerSave(page, 1);

  // The new organization's page shows its own feedback, and only that one ever rendered.
  await draft.fill('Notiz der zweiten Organisation');
  await page.getByRole('button', { name: 'Entwurf speichern' }).click();
  await answerSave(page, 2);
  await expect(page.getByRole('alert')).toContainText('Gespeichert: Notiz der zweiten Organisation');
  expect(await shownBanners()).toEqual(['Gespeichert: Notiz der zweiten Organisation']);
});
