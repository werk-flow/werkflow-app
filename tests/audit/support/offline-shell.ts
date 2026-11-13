import { existsSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join, resolve } from 'node:path';

import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { serviceWorkerScript } from '../../../lib/offline/service-worker-script';

// Locators and cache reads of the installable app shell (/sw.js). The
// spec passes data; the copy and the cache inspection live here.

const OFFLINE_COPY = {
  title: 'Gerade kein Netz',
  retry: 'Erneut versuchen',
} as const;

const REPOSITORY_ROOT = resolve(__dirname, '../../..');

/** Where the app serves its static files from: a cached image is a shell file only if it exists here. */
const PUBLIC_ROOT = resolve(__dirname, '../../../public');

/** The prefix of every cache the service worker owns (lib/offline/service-worker-caches.ts). */
const CACHE_PREFIX = 'werkflow-';

/** The worker names its shell cache after the shell version (lib/offline/service-worker.js). */
function shellCacheName(version: string): string {
  return `${CACHE_PREFIX}shell-${version}`;
}

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
  await expectServiceWorkerCaches(page, []);
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

/** The worker a production build with this build id serves. */
function servedFor(buildId: string): string {
  return serviceWorkerScript(REPOSITORY_ROOT, 'phase-production-build', { WERKFLOW_BUILD_ID: buildId });
}

/** The shell version the deployment behind `withDeployableOrigin` moves to. */
const NEXT_BUILD = 'next-build';

/**
 * Asserts that `/sw.js` serves the worker lib/offline/service-worker-script.ts
 * composes for the served build's id (the `x-werkflow-build` header of a
 * cookie-free `/login`), cookie-free, and that the page's shell cache is named
 * after that id.
 */
export async function expectShellOfServedBuild(page: Page, request: APIRequestContext): Promise<void> {
  const login = await request.get('/login', { maxRedirects: 0 });
  const buildId = login.headers()['x-werkflow-build'] ?? '';
  expect(buildId, 'the recorded build names its id on /login').not.toBe('');
  const worker = await request.get('/sw.js');
  expect(worker.headers()['content-type']).toContain('javascript');
  expect(worker.headers()['set-cookie']).toBeUndefined();
  expect(await worker.text()).toBe(servedFor(buildId));
  await expectServiceWorkerCaches(page, [shellCacheName(buildId)]);
}

/** Waits until the caches the service worker owns are exactly `names`. */
async function expectServiceWorkerCaches(page: Page, names: readonly string[]): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(
          async (prefix) => (await caches.keys()).filter((name) => name.startsWith(prefix)),
          CACHE_PREFIX,
        ),
      { message: 'The service worker owns exactly these caches' },
    )
    .toEqual(names);
}

/** An origin in front of the test server whose `/sw.js` moves to a later build on `deployNextBuild`. */
type DeployableOrigin = { origin: string; deployNextBuild: () => void };

/**
 * Runs `run` against a pass-through proxy to the test server. Until
 * `deployNextBuild`, every request, `/sw.js` included, reaches the served
 * build unchanged; after it, `/sw.js` answers with the same source under
 * another shell version, as the next deployment would. Playwright cannot
 * route a browser's own update check of a worker script, so the second build
 * sits behind this proxy. The session cookies of `localhost` hold on its port.
 */
export async function withDeployableOrigin(
  appOrigin: string,
  run: (deployment: DeployableOrigin) => Promise<void>,
): Promise<void> {
  const app = new URL(appOrigin);
  let deployed: string | null = null;
  const server = createServer((incoming, outgoing) => {
    if (deployed !== null && new URL(incoming.url ?? '/', app).pathname === '/sw.js') {
      outgoing.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
      outgoing.end(deployed);
      return;
    }
    const upstream = httpRequest(
      {
        host: app.hostname,
        port: app.port,
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (answer) => {
        outgoing.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(outgoing);
      },
    );
    upstream.once('error', () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((ready) => server.listen(0, app.hostname, ready));
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The proxy has no port.');
    await run({
      origin: `${app.protocol}//${app.hostname}:${address.port}`,
      deployNextBuild: () => {
        deployed = servedFor(NEXT_BUILD);
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((closed) => server.close(() => closed()));
  }
}

/**
 * Runs the update check a phone runs when it opens the app after a
 * deployment, and waits until the next build's worker filled its shell and
 * deleted every other cache.
 */
export async function expectNextBuildShellAfterUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  await expectServiceWorkerCaches(page, [shellCacheName(NEXT_BUILD)]);
  await waitForOfflineShell(page);
}
