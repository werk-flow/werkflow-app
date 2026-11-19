import { expect, test, type Page, type Route } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// „Erneut versuchen“ on the offline page (werk-flow/werkflow-planning#22, the
// 2026-11-14 iPhone re-test): a tap shows the spinner in its first frame,
// checks the connection and reloads into the app; without signal it says so
// in place and stays usable. The signal coming back runs the same attempt,
// also when it came back before the page could listen for it.

const CONTRACT_URL = 'http://localhost/ui-contracts';
/** The probe of app/offline/return-to-app.ts: a HEAD request the service worker never answers. */
const PROBE_URL = 'http://localhost/manifest.webmanifest';

/**
 * Opens the offline page's recovery as the page renders it (ReturnOnSignal and RetryButton), on a
 * phone that reports a network or none. The test switches the report with `reportNetwork`.
 */
async function mountRecovery(page: Page, { online }: { online: boolean }): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route(`${CONTRACT_URL}**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.addInitScript((initial) => {
    let reported = initial;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => reported });
    Object.assign(window, { reportNetwork: (next: boolean) => void (reported = next) });
  }, online);
  await page.goto(CONTRACT_URL);
  await page.evaluate(() => {
    window.uiContractFixture = 'offline-retry';
  });
  await page.addScriptTag({ path: bundle });
}

/** The phone's network report changes, as the browser announces it with `online`. */
async function signalReturns(page: Page): Promise<void> {
  await page.evaluate(() => {
    Reflect.get(window, 'reportNetwork')(true);
    window.dispatchEvent(new Event('online'));
  });
}

/** Holds each connection check until the test answers it. */
async function holdProbes(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.route(PROBE_URL, (route) => {
    held.push(route);
  });
  return held;
}

/**
 * Holds the reload into the app, so the test sees the page while it waits for the app. Registered
 * after the mount's route, so it answers first.
 */
async function holdReload(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.route(CONTRACT_URL, (route) => {
    held.push(route);
  });
  return held;
}

const retryButton = (page: Page) => page.getByRole('button', { name: 'Erneut versuchen' });

/** Where the page notes that the busy mark dropped; sessionStorage outlives the reload. */
const BUSY_DROPPED_KEY = 'offline-retry-contract:busy-dropped';

/**
 * Notes, in the page, any moment the button stops being busy. A locator or evaluate waits for a
 * pending navigation, so the page itself records what it showed while the held reload stood.
 */
async function watchBusy(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const button = document.querySelector('main button[type="submit"]');
    if (!button) throw new Error('No retry button to watch.');
    new MutationObserver(() => {
      if (button.getAttribute('aria-busy') !== 'true') sessionStorage.setItem(key, 'yes');
    }).observe(button, { attributes: true });
  }, BUSY_DROPPED_KEY);
}

/** Lets the held reload through and answers whether the button stayed busy until then. */
async function stayedBusyUntilReplaced(page: Page, reload: Route | undefined): Promise<boolean> {
  const replaced = page.waitForEvent('load');
  await reload?.fulfill({ contentType: 'text/html', body: '<html lang="de"><body></body></html>' });
  await replaced;
  return page.evaluate((key) => sessionStorage.getItem(key) === null, BUSY_DROPPED_KEY);
}

test('a tap without signal is busy at once, then says in place that there is no signal and stays usable', async ({
  page,
}) => {
  const held = await holdProbes(page);
  await mountRecovery(page, { online: false });
  await retryButton(page).click();
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => held.length).toBe(1);
  expect(held[0]?.request().method()).toBe('HEAD');
  await held[0]?.abort('internetdisconnected');
  await expect(page.getByRole('alert')).toHaveText(
    'Immer noch kein Netz. Sobald du wieder Empfang hast, öffnet sich WerkFlow von selbst.',
  );
  await expect(retryButton(page)).toBeEnabled();
  await expect(retryButton(page)).not.toHaveAttribute('aria-busy');

  // The next tap tries again and takes the message away while it checks.
  await retryButton(page).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => held.length).toBe(2);
});

test('a tap with signal reloads the address the person opened, and stays busy until the app replaces the page', async ({
  page,
}) => {
  const held = await holdProbes(page);
  await mountRecovery(page, { online: false });
  await retryButton(page).click();
  await expect.poll(() => held.length).toBe(1);
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  await watchBusy(page);
  const reloads = await holdReload(page);
  await held[0]?.fulfill({ status: 200 });
  await expect.poll(() => reloads.length).toBe(1);
  expect(await stayedBusyUntilReplaced(page, reloads[0])).toBe(true);
});

test('the signal coming back runs the same attempt as a tap, busy until the app replaces the page', async ({
  page,
}) => {
  const held = await holdProbes(page);
  await mountRecovery(page, { online: false });
  await signalReturns(page);
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => held.length).toBe(1);
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  await watchBusy(page);
  const reloads = await holdReload(page);
  await held[0]?.fulfill({ status: 200 });
  await expect.poll(() => reloads.length).toBe(1);
  expect(await stayedBusyUntilReplaced(page, reloads[0])).toBe(true);
});

test('a signal whose first check fails while the connection settles opens the app on a later check', async ({
  page,
}) => {
  const held = await holdProbes(page);
  await mountRecovery(page, { online: false });
  await signalReturns(page);
  await expect.poll(() => held.length).toBe(1);
  // Wi-Fi joined but routes nothing yet.
  await held[0]?.abort('internetdisconnected');
  await expect.poll(() => held.length).toBe(2);
  const reloads = await holdReload(page);
  await held[1]?.fulfill({ status: 200 });
  await expect.poll(() => reloads.length).toBe(1);
  await reloads[0]?.fulfill({ contentType: 'text/html', body: '<html lang="de"><body></body></html>' });
});

test('a signal that came back before the page could listen starts the way back at once', async ({ page }) => {
  const held = await holdProbes(page);
  await mountRecovery(page, { online: true });
  await expect.poll(() => held.length).toBe(1);
  // The page checks on its own; the button stays free for a tap.
  await expect(retryButton(page)).toBeEnabled();
  const reloads = await holdReload(page);
  await held[0]?.fulfill({ status: 200 });
  await expect.poll(() => reloads.length).toBe(1);
  await reloads[0]?.fulfill({ contentType: 'text/html', body: '<html lang="de"><body></body></html>' });
});

test('a start right after a reload that came back here waits for the signal or a tap', async ({ page }) => {
  const held = await holdProbes(page);
  // This page reloaded itself a moment ago and the offline page came back.
  await page.addInitScript(() => sessionStorage.setItem('werkflow:offline-reloaded-at', String(Date.now())));
  await mountRecovery(page, { online: true });
  await expect(retryButton(page)).toBeEnabled();
  await expect(retryButton(page)).not.toHaveAttribute('aria-busy');
  expect(held).toHaveLength(0);
  await retryButton(page).click();
  await expect.poll(() => held.length).toBe(1);
});
