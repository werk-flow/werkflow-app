import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { expect, type Locator, type Page } from '@playwright/test';

// Locators and cache reads of the installable app shell (public/sw.js). The
// spec passes data; the copy and the cache inspection live here.

const OFFLINE_COPY = {
  title: 'Gerade kein Netz',
  retry: 'Erneut versuchen',
} as const;

/** Where the app serves its static files from: a cached image is a shell file only if it exists here. */
const PUBLIC_ROOT = resolve(__dirname, '../../../public');

/** The prefix of every cache the service worker owns (lib/offline/service-worker-caches.ts). */
const CACHE_PREFIX = 'werkflow-';

/** The offline fallback the service worker serves for a navigation without network. */
export function offlineFallback(page: Page): Locator {
  return page.getByRole('heading', { level: 1, name: OFFLINE_COPY.title });
}

export function offlineRetryButton(page: Page): Locator {
  return page.getByRole('button', { name: OFFLINE_COPY.retry });
}

/**
 * Takes the page's browser context off the network, or back on. The premise
 * here is a device without signal, not outdated live state: the service
 * worker's own requests go offline with the page (Chromium emulates the
 * context's network for its workers too).
 */
export async function setNetwork(page: Page, state: 'offline' | 'online'): Promise<void> {
  await page.context().setOffline(state === 'offline');
}

/**
 * Takes the browser's HTTP cache out of the offline proof and keeps the
 * service worker's Cache Storage. Filling the shell warms the HTTP cache,
 * which could otherwise serve a file the worker failed to store, so an
 * offline page would hydrate without the worker. The clear covers the
 * worker's own fetches; the disabled cache covers the page's. Chromium only.
 */
export async function bypassHttpCache(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.clearBrowserCache');
  await session.send('Network.setCacheDisabled', { cacheDisabled: true });
}

/** Waits until the service worker is active and its shell cache holds the offline page. */
export async function waitForOfflineShell(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(async () => Boolean(await caches.match('/offline'))), {
      message: 'The service worker stores the offline page in its shell cache',
    })
    .toBe(true);
}

/**
 * Asserts that every response a service worker cache holds is the offline page
 * or a static file, and that the offline page names none of `personalTexts`.
 */
export async function expectOnlyShellFilesCached(
  page: Page,
  personalTexts: readonly string[],
): Promise<void> {
  const entries = await page.evaluate(async (prefix) => {
    const found: { path: string; body: string }[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith(prefix)) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        found.push({ path: new URL(request.url).pathname, body: (await response?.text()) ?? '' });
      }
    }
    return found;
  }, CACHE_PREFIX);
  const isShellFile = (path: string): boolean =>
    path === '/offline' ||
    path.startsWith('/_next/static/') ||
    // An image counts only as a file of public/, so a cached API or page path under an image name still fails.
    (/^\/(?:[\w-]+\/)*[\w-]+\.(?:svg|png)$/.test(path) && existsSync(join(PUBLIC_ROOT, path)));
  expect(entries.map((entry) => entry.path).filter((path) => !isShellFile(path))).toEqual([]);
  const offlinePage = entries.find((entry) => entry.path === '/offline');
  expect(offlinePage?.body).toContain(OFFLINE_COPY.title);
  for (const text of personalTexts) expect(offlinePage?.body).not.toContain(text);
}

/** Asserts that no cache the service worker owns is left. */
export async function expectNoServiceWorkerCaches(page: Page): Promise<void> {
  const names = await page.evaluate(
    async (prefix) => (await caches.keys()).filter((name) => name.startsWith(prefix)),
    CACHE_PREFIX,
  );
  expect(names).toEqual([]);
}

/** A cache under the worker's prefix with one entry: the stand-in for a later data cache. */
const PROBE_CACHE = `${CACHE_PREFIX}probe`;

/** Puts one personal entry into a cache the service worker owns. */
export async function plantOwnedCache(page: Page, personalText: string): Promise<void> {
  await page.evaluate(
    async ({ name, text }) => {
      const cache = await caches.open(name);
      await cache.put('/probe', new Response(text));
    },
    { name: PROBE_CACHE, text: personalText },
  );
}

/** Asserts that the cache `plantOwnedCache` filled is deleted. */
export async function expectOwnedCacheDeleted(page: Page): Promise<void> {
  expect(await page.evaluate((name) => caches.has(name), PROBE_CACHE)).toBe(false);
}
