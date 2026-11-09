import { expect, type Locator, type Page } from '@playwright/test';

// Locators and cache reads of the installable app shell (public/sw.js). The
// spec passes data; the copy and the cache inspection live here.

const OFFLINE_COPY = {
  title: 'Gerade kein Netz',
  retry: 'Erneut versuchen',
} as const;

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

/** Waits until the service worker is active and its shell cache holds the offline page. */
export async function waitForOfflineShell(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(async () => Boolean(await caches.match('/offline'))), {
      message: 'The service worker stores the offline page in its shell cache',
    })
    .toBe(true);
}

export type CachedEntry = { cache: string; path: string; body: string };

/** Every request the service worker owns a cached response for, with the response text. */
export async function serviceWorkerCacheEntries(page: Page): Promise<CachedEntry[]> {
  return page.evaluate(async (prefix) => {
    const entries: { cache: string; path: string; body: string }[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith(prefix)) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({
          cache: name,
          path: new URL(request.url).pathname,
          body: (await response?.text()) ?? '',
        });
      }
    }
    return entries;
  }, CACHE_PREFIX);
}

/** The names of the caches the service worker owns. */
export async function serviceWorkerCacheNames(page: Page): Promise<string[]> {
  return page.evaluate(
    async (prefix) => (await caches.keys()).filter((name) => name.startsWith(prefix)),
    CACHE_PREFIX,
  );
}
