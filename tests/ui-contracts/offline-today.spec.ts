import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import type { OfflineTodayContact } from './offline-today-service-boundaries';

// Without signal the phone shows its stored day, until a sign-out or an
// organization switch in another tab wipes it (decision record 0010, "Device
// data"). The former person's day must vanish at the wipe signal, also when a
// device read that began before the wipe answers after it.

/** The cross-tab wipe signal of lib/field-sync/device/today-wipe.ts. */
const TODAY_WIPE_KEY = 'werkflow:today-wiped';
/** The device claim of lib/field-sync/device/today-wipe.ts, which every wipe removes first. */
const TODAY_HOLDER_KEY = 'werkflow:today-holder';
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

async function answerRead(
  page: Page,
  read: number,
  withDay: boolean,
  contact?: OfflineTodayContact,
): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.offlineTodayContract.reads)).toBe(read);
  await page.evaluate(([day, person]) => window.offlineTodayContract.answer(day, person), [
    withDay,
    contact,
  ] as const);
}

/** The view reads the path when the device answers: there it opens the job's pack. */
async function openPack(page: Page): Promise<void> {
  await page.evaluate(() => history.replaceState(null, '', '/auftraege/AUF-2026-21'));
}

// werk-flow/werkflow-planning#367: a private customer is usually their own
// contact; the „Kontakt“ fact names them once, like the work pack.
test('a customer who is their own contact is named once under „Kontakt“', async ({ page }) => {
  await openPack(page);
  await answerRead(page, 1, true, { name: 'Familie Muster', role: 'Eigentümer' });
  const facts = page.getByRole('main').getByRole('region', { name: 'Vor dem Einsatz' });
  await expect(facts.getByText('Eigentümer', { exact: true })).toBeVisible();
  await expect(facts.getByText('Familie Muster', { exact: true })).toHaveCount(1);
});

test('a contact other than the customer keeps the customer line under „Kontakt“', async ({ page }) => {
  await openPack(page);
  await answerRead(page, 1, true, { name: 'Erika Hausmeister', role: 'Hausverwaltung' });
  const facts = page.getByRole('main').getByRole('region', { name: 'Vor dem Einsatz' });
  await expect(facts.getByText('Erika Hausmeister', { exact: true })).toBeVisible();
  await expect(facts.getByText('Familie Muster', { exact: true })).toBeVisible();
});

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

test('a shown day vanishes when another tab’s wipe removes the claim but cannot write its signal', async ({
  page,
}) => {
  await answerRead(page, 1, true);
  await expect(page.getByRole('main').getByText(JOB_TITLE)).toBeVisible();
  // Another tab signs out with a full quota: only the claim's removal reaches this tab.
  await page.evaluate((key) => {
    localStorage.removeItem(key);
    window.dispatchEvent(new StorageEvent('storage', { key }));
  }, TODAY_HOLDER_KEY);
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
