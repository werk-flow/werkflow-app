import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { formatBerlinLocalDate, getLocalDayEnd } from '@/lib/date-time/berlin';
import { FIELD_SYNC_TODAY_PATH } from '@/lib/field-sync/today-snapshot';
import { TODAY_DATABASE, TODAY_HOLDER_KEY, TODAY_WIPE_KEY } from '@/lib/field-sync/device/today-wipe';
import { openContractFixture } from './open-fixture';
import { TODAY_CONTRACT_ORGANIZATIONS, TODAY_CONTRACT_USER } from './today-refresh-world';

/** The Berlin business day of `now` and its end, as the server's snapshot names them (lib/field-sync/today.ts). */
function businessDay(now: Date): { berlinDate: string; validUntil: string } {
  return {
    berlinDate: formatBerlinLocalDate(now),
    validUntil: new Date(getLocalDayEnd(now).getTime() + 1).toISOString(),
  };
}

/** The person and organization of the device claim, without the claiming tab's token. */
async function claimedHolder(page: Page): Promise<string | null> {
  const claim = await page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY);
  return claim === null ? null : claim.split(':').slice(0, 2).join(':');
}

/**
 * Answers the start page's day requests with an empty day of the requested organization and
 * records each organization asked for. With `held`, every answer waits until it resolves.
 */
async function routeTodayDays(page: Page, held?: Promise<void>): Promise<string[]> {
  const requested: string[] = [];
  await page.route(
    (url) => url.pathname === FIELD_SYNC_TODAY_PATH,
    async (route) => {
      const organizationId = new URL(route.request().url()).searchParams.get('organizationId') ?? '';
      requested.push(organizationId);
      await held;
      await route.fulfill({
        json: {
          version: `day-of-${organizationId}`,
          ...businessDay(new Date()),
          userId: TODAY_CONTRACT_USER,
          organizationId,
          assignments: [],
        },
      });
    },
  );
  return requested;
}

/**
 * Delivers another tab's wipe signal to this page, as the browser does: a `storage` event, later
 * than the write. `null` is another tab's `localStorage.clear()`, which takes signal and claim alike.
 */
async function deliverForeignWipeSignal(page: Page, key: string | null = TODAY_WIPE_KEY): Promise<void> {
  await page.evaluate(
    (changed) =>
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: changed,
          newValue: changed === null ? null : localStorage.getItem(changed),
          storageArea: localStorage,
        }),
      ),
    key,
  );
}

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
  const requested = await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-switch');
  const storedOrganization = () => page.evaluate(() => window.todayRefreshContract.storedOrganization());
  const claim = () => claimedHolder(page);

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

// A sign-out wipes the device before it ends the session. A membership refresh that lands then and
// falls back to another organization changes the active organization without an explicit switch:
// the page keeps the wipe generation it loaded with, so nothing is claimed or stored.
test('a membership fallback that lands during a sign-out never claims the device or stores a day', async ({
  page,
}) => {
  const [first] = TODAY_CONTRACT_ORGANIZATIONS;
  const requested = await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-fallback');
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(first);

  await page.getByRole('button', { name: 'Abmelden', exact: true }).click();
  await expect
    .poll(() => page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name)))
    .toEqual([]);
  await page.getByRole('button', { name: 'Mitgliedschaften neu laden', exact: true }).click();
  // The fallback wipes, then writes the remaining organization's cookie; answered once pending.
  await expect.poll(() => page.evaluate(() => window.organizationContract.writes.length)).toBe(1);
  await page.evaluate(() => window.organizationContract.finishCookie(true));

  // The page handed the refresh the remaining organization; a claim would be in place by now.
  await expect.poll(() => page.evaluate(() => window.todayRefreshStarts)).toBe(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
  expect(await page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
  expect(requested).toEqual([first]);
});

// A sign-out in another tab while this tab's switch waits for its cookie wipes after the switch's
// own wipe. The switch may claim only under the generation its own wipe produced, so the sign-out's
// later wipe still blocks the claim: nothing is claimed or stored for the new organization.
test('a sign-out in another tab during a switch keeps the switched page from claiming or storing a day', async ({
  page,
}) => {
  const [first] = TODAY_CONTRACT_ORGANIZATIONS;
  const requested = await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(first);

  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.organizationContract.writes.length)).toBe(1);
  // Another tab signs out while the switch's cookie write is pending: it wipes the device.
  await page.evaluate(
    async ({ holderKey, wipeKey, database }) => {
      localStorage.removeItem(holderKey);
      localStorage.setItem(wipeKey, 'sign-out-in-another-tab');
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(database);
        request.onsuccess = () => resolve();
      });
    },
    { holderKey: TODAY_HOLDER_KEY, wipeKey: TODAY_WIPE_KEY, database: TODAY_DATABASE },
  );
  await page.evaluate(() => window.organizationContract.finishCookie(true));

  // The page handed the refresh the new organization; a claim would be in place by now.
  await expect.poll(() => page.evaluate(() => window.todayRefreshStarts)).toBe(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
  expect(await page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
  expect(requested).toEqual([first]);
});

// Another tab's sign-out can write its wipe signal right after this tab's switch wiped and before
// this page renders the switch, so the switch reads the sign-out's generation as its own and claims.
// The browser delivers that write's `storage` event later: the page then drops its claim, so no
// claim stands and no stored day is readable.
test('a foreign wipe between a switch and its first render leaves no claim and no readable day', async ({
  page,
}) => {
  const [first, second] = TODAY_CONTRACT_ORGANIZATIONS;
  await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(first);
  // The next wipe signal this tab writes (the switch's) is followed at once by another tab's
  // sign-out in the shared storage.
  await page.evaluate(
    ({ holderKey, wipeKey }) => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string): void {
        write.call(this, key, value);
        if (key !== wipeKey) return;
        Storage.prototype.setItem = write;
        this.removeItem(holderKey);
        write.call(this, wipeKey, 'sign-out-in-another-tab');
      };
    },
    { holderKey: TODAY_HOLDER_KEY, wipeKey: TODAY_WIPE_KEY },
  );

  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.organizationContract.writes.length)).toBe(1);
  await page.evaluate(() => window.organizationContract.finishCookie(true));
  // The switch read the sign-out's generation, so it claims the new organization.
  await expect.poll(() => claimedHolder(page)).toBe(`${TODAY_CONTRACT_USER}:${second}`);

  await deliverForeignWipeSignal(page);

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
});

// A refresh whose answer is still on its way when another tab's wipe signal arrives saves nothing a
// reader shows: the page drops its claim, so the refresh no longer owns the device.
test('a foreign wipe signal while a refresh is in flight leaves no readable day', async ({ page }) => {
  let release = (): void => undefined;
  const requested = await routeTodayDays(
    page,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => requested.length).toBe(1);

  await deliverForeignWipeSignal(page);
  release();

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
});

// Another tab that clears all of localStorage removes the wipe signal and the claim at once; its
// `storage` event has no key. The page treats it as a foreign wipe.
test('another tab clearing all storage while a refresh is in flight leaves no readable day', async ({
  page,
}) => {
  let release = (): void => undefined;
  const requested = await routeTodayDays(
    page,
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => requested.length).toBe(1);

  await deliverForeignWipeSignal(page, null);
  release();

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), TODAY_HOLDER_KEY)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
});

// Every sign-out lands on an `(auth)` page once its session ended, and that page wipes the phone
// again: a claimed, readable day is gone.
test('the page a sign-out lands on leaves no claim and no readable day', async ({ page }) => {
  const [first] = TODAY_CONTRACT_ORGANIZATIONS;
  await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(first);
  expect(await claimedHolder(page)).toBe(`${TODAY_CONTRACT_USER}:${first}`);

  await page.getByRole('button', { name: 'Zur Anmeldung', exact: true }).click();

  await expect.poll(() => claimedHolder(page)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
});

// The ordering no tab-local rule closes: this tab's switch wipes, another tab's sign-out writes its
// wipe signal before this page renders the switch, and the switch claims and saves under that
// signal before its `storage` event arrives. The sign-out's landing page, after its session ended,
// wipes again: no day stays readable, whatever this tab does next.
test('a day a switch saved under a foreign sign-out signal is gone once that sign-out lands', async ({
  page,
}) => {
  const [, second] = TODAY_CONTRACT_ORGANIZATIONS;
  await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => claimedHolder(page)).not.toBeNull();
  await page.evaluate(
    ({ holderKey, wipeKey }) => {
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string): void {
        write.call(this, key, value);
        if (key !== wipeKey) return;
        Storage.prototype.setItem = write;
        this.removeItem(holderKey);
        write.call(this, wipeKey, 'sign-out-in-another-tab');
      };
    },
    { holderKey: TODAY_HOLDER_KEY, wipeKey: TODAY_WIPE_KEY },
  );
  await page.getByRole('button', { name: 'Organisation wechseln', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.organizationContract.writes.length)).toBe(1);
  await page.evaluate(() => window.organizationContract.finishCookie(true));
  // Before the event arrives, the switch claims and saves under the sign-out's signal.
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(second);

  // The sign-out's session ended, and its landing page wipes.
  await page.getByRole('button', { name: 'Zur Anmeldung', exact: true }).click();

  await expect.poll(() => claimedHolder(page)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
});

// The `(auth)` layout stays mounted from `/reset-password` to `/login`, where the password reset
// lands once its session ended. The landing wipe runs on every page of the layout, so a day stored
// in between is gone once the reset reaches `/login`.
test('a password reset that moves from its form to the login page wipes the phone again', async ({
  page,
}) => {
  const [first, second] = TODAY_CONTRACT_ORGANIZATIONS;
  await routeTodayDays(page);
  await openContractFixture(page, 'today-refresh-switch');
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(first);
  // The reset form's page mounts the layout and its wipe.
  await page.getByRole('button', { name: 'Zur Anmeldung', exact: true }).click();
  await expect.poll(() => claimedHolder(page)).toBeNull();

  // A day another tab stores while the reset's session still answers.
  await page.evaluate((organizationId) => window.todayRefreshContract.storeDay(organizationId), second);
  expect(await page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBe(second);

  await page.evaluate(() => window.todayLanding.navigate('/login'));

  await expect.poll(() => claimedHolder(page)).toBeNull();
  await expect.poll(() => page.evaluate(() => window.todayRefreshContract.storedOrganization())).toBeNull();
});
