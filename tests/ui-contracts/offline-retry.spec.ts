import { expect, test, type Page, type Route } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// „Erneut versuchen“ on the offline page (werk-flow/werkflow-planning#22, the
// 2026-11-14 iPhone re-test): a tap shows the spinner in its first frame,
// checks the connection and reloads into the app; without signal it says so
// in place and stays usable. The signal coming back runs the same attempt.

const CONTRACT_URL = 'http://localhost/ui-contracts';
/** The probe of app/offline/return-to-app.ts: a HEAD request the service worker never answers. */
const PROBE_URL = 'http://localhost/manifest.webmanifest';

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route(`${CONTRACT_URL}**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(CONTRACT_URL);
  await page.evaluate(() => {
    window.uiContractFixture = 'offline-retry';
  });
  await page.addScriptTag({ path: bundle });
});

/** Holds each connection check until the test answers it. */
async function holdProbes(page: Page): Promise<Route[]> {
  const held: Route[] = [];
  await page.route(PROBE_URL, (route) => {
    held.push(route);
  });
  return held;
}

const retryButton = (page: Page) => page.getByRole('button', { name: 'Erneut versuchen' });

test('a tap without signal is busy at once, then says in place that there is no signal and stays usable', async ({
  page,
}) => {
  const held = await holdProbes(page);
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
  await retryButton(page).click();
  await expect.poll(() => held.length).toBe(1);
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  const reload = page.waitForRequest(
    (request) => request.isNavigationRequest() && request.url() === CONTRACT_URL,
  );
  await held[0]?.fulfill({ status: 200 });
  await reload;
});

test('the signal coming back runs the same attempt as a tap', async ({ page }) => {
  const held = await holdProbes(page);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(retryButton(page)).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => held.length).toBe(1);
  const reload = page.waitForRequest(
    (request) => request.isNavigationRequest() && request.url() === CONTRACT_URL,
  );
  await held[0]?.fulfill({ status: 200 });
  await reload;
});
