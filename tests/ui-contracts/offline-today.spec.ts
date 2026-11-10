import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// Without signal the phone shows its stored day, until a sign-out or an
// organization switch in another tab wipes it (decision record 0010, "Device
// data"). The former person's day must vanish at the wipe signal, also when a
// device read that began before the wipe answers after it.

/** The cross-tab wipe signal of lib/field-sync/device/today-wipe.ts. */
const TODAY_WIPE_KEY = 'werkflow:today-wiped';
const JOB_TITLE = 'Heizung tauschen bei Familie Muster';

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
    window.uiContractFixture = 'offline-today';
  });
  await page.addScriptTag({ path: bundle });
});

async function answerRead(page: Page, read: number, withDay: boolean): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.offlineTodayContract.reads)).toBe(read);
  await page.evaluate((day) => window.offlineTodayContract.answer(day), withDay);
}

test('a shown day vanishes at another tab’s wipe signal, before the next read answers', async ({ page }) => {
  await answerRead(page, 1, true);
  await expect(page.getByRole('main').getByText(JOB_TITLE)).toBeVisible();
  // Another tab signs out: its wipe signal arrives, and the next read is still on its way.
  await page.evaluate((key) => {
    localStorage.setItem(key, 'another-tab-sign-out');
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, TODAY_WIPE_KEY);
  await expect(page.getByRole('main').getByText('Gerade kein Netz')).toBeVisible();
  await expect(page.getByRole('main').getByText(JOB_TITLE)).toHaveCount(0);
  await answerRead(page, 2, false);
  await expect(page.getByRole('main').getByText('Gerade kein Netz')).toBeVisible();
});

test('a read that began before another tab’s wipe and answers after it shows nothing of the old day', async ({
  page,
}) => {
  await expect.poll(() => page.evaluate(() => window.offlineTodayContract.reads)).toBe(1);
  // The wipe lands while the read is on its way; its storage event has not arrived yet.
  await page.evaluate((key) => localStorage.setItem(key, 'another-tab-sign-out'), TODAY_WIPE_KEY);
  await answerRead(page, 1, true);
  await expect(page.getByRole('main').getByText('Gerade kein Netz')).toBeVisible();
  await expect(page.getByRole('main').getByText(JOB_TITLE)).toHaveCount(0);
});
