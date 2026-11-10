import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { FIELD_SYNC_TODAY_PATH } from '@/lib/field-sync/today-snapshot';
import { TODAY_HOLDER_KEY } from '@/lib/field-sync/device/today-wipe';
import { openContractFixture } from './open-fixture';
import { TODAY_CONTRACT_ORGANIZATIONS, TODAY_CONTRACT_USER } from './today-refresh-world';

// The start page stores the field worker's day for use without signal. When
// its code cannot load, the worker learns it while the signal lasts, with a
// reload as the way out, and the page goes on without an uncaught error.

test('a refresh code that fails to load warns the worker and offers a reload, without throwing', async ({
  page,
}) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const uncaught: string[] = [];
  page.on('pageerror', (error) => uncaught.push(error.message));
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'today-refresh';
  });
  await page.addScriptTag({ path: bundle });

  await expect(page.getByRole('alert')).toContainText(
    'Deine Einsätze von heute sind auf diesem Gerät nicht für offline gespeichert.',
  );
  await expect(page.getByRole('alert').getByRole('button', { name: 'Für offline neu laden' })).toBeVisible();
  expect(uncaught).toEqual([]);
});

// The start page takes person and organization from the app's client contexts. An organization
// switch changes them before any server render, so the device's claim and the stored day follow
// the switch at once, and nothing is saved under the former organization afterwards.
test('after an organization switch the refresh claims the new organization and never saves under the old one', async ({
  page,
}) => {
  const [first, second] = TODAY_CONTRACT_ORGANIZATIONS;
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === FIELD_SYNC_TODAY_PATH,
    (route) => {
      const organizationId = new URL(route.request().url()).searchParams.get('organizationId') ?? '';
      requested.push(organizationId);
      return route.fulfill({
        json: {
          version: `day-of-${organizationId}`,
          berlinDate: '2026-11-09',
          validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          userId: TODAY_CONTRACT_USER,
          organizationId,
          assignments: [],
        },
      });
    },
  );
  await openContractFixture(page, 'today-refresh-switch');
  const storedOrganization = () => page.evaluate(() => window.todayRefreshContract.storedOrganization());
  const claim = () => page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY);

  await expect.poll(storedOrganization).toBe(first);
  expect(await claim()).toBe(`${TODAY_CONTRACT_USER}:${first}`);

  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  // The switch wipes the day before it writes the cookie; the write is answered once it is pending.
  await expect.poll(() => page.evaluate(() => window.organizationContract.writes.length)).toBe(1);
  await page.evaluate(() => window.organizationContract.finishCookie(true));

  await expect.poll(storedOrganization).toBe(second);
  expect(await claim()).toBe(`${TODAY_CONTRACT_USER}:${second}`);
  expect(requested).toEqual([first, second]);
});

// A sign-out wipes the device before it ends the session. When the person's profile arrives
// only after that wipe, from a read the browser makes itself, the page must not claim the device
// again while the ending session still answers: no claim and no day survive the sign-out.
test('a profile that arrives after a sign-out wiped the device never claims it or stores a day', async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === FIELD_SYNC_TODAY_PATH,
    (route) => {
      requested.push(route.request().url());
      return route.abort();
    },
  );
  await openContractFixture(page, 'today-refresh-profile');
  await expect.poll(() => page.evaluate(() => window.todayRefreshProfile.reads)).toBe(1);

  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect
    .poll(() => page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name)))
    .toEqual([]);
  await page.evaluate(() => window.todayRefreshProfile.release());

  // The page handed the refresh its person and organization; a claim would be in place by now.
  await expect.poll(() => page.evaluate(() => window.todayRefreshStarts)).toBe(1);
  expect(await page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
  expect(await page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
  expect(requested).toEqual([]);
});
