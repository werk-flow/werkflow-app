// WerkFlow's service worker: the app shell that opens without signal.
//
// It keeps exactly one cache, the shell: the offline fallback page and the
// static build files that page loads. The fallback is fetched without
// cookies, so no response in the cache can carry a user, an organization or
// a role. A navigation goes to the network unchanged; only when the network
// fails does the worker answer with the fallback. Every other request goes to
// the network untouched while the device has a network; without one, the
// worker answers only shell files from the cache and lets the rest fail as
// it would. It never writes a response it did not request itself, so no RSC,
// API or authenticated page ever enters the cache.
//
// The page clears every cache whose name starts with CACHE_PREFIX on sign-out
// and on an organization switch (lib/offline/service-worker-caches.ts owns the
// same prefix; lib/security/service-worker.test.ts pins both). The next
// navigation fills the shell again. A signed-in page that navigates on the
// client sends REFILL_MESSAGE instead, so the fallback is back before the
// signal goes.
//
// Bump SHELL_VERSION when this file changes what the shell holds.

const CACHE_PREFIX = 'werkflow-';
const SHELL_VERSION = 1;
const SHELL_CACHE = `${CACHE_PREFIX}shell-v${SHELL_VERSION}`;
const OFFLINE_PATH = '/offline';
const REFILL_MESSAGE = 'werkflow:refill-shell';
// Same-origin files the fallback page references: the build's hashed files
// and the logos and icons under public/, folders included. Escaped quotes inside the streamed
// RSC payload end a match the same way plain quotes do. A match starts only
// where a root-relative path can: never after a host name or another path
// segment, so `https://api.png.example.com` or `https://cdn.example.com/a.svg`
// yields nothing (an unfetchable path would fail the whole install).
const SHELL_ASSET = /(?<![\w.:/-])\/(?:_next\/static\/[^"'\s\\)]+|(?:[\w-]+\/)*[\w-]+\.(?:svg|png))/g;

/** Clients that were answered with the fallback; their files come from the shell. */
const fallbackClients = new Set();

async function fillShell() {
  const page = await fetch(OFFLINE_PATH, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (!page.ok) throw new Error(`The offline page answered ${page.status}.`);
  const html = await page.clone().text();
  const assets = [...new Set(html.match(SHELL_ASSET) ?? [])];
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(assets.map((path) => new Request(path, { credentials: 'omit' })));
  // The page goes in last: a cache that holds the page holds its files.
  await cache.put(OFFLINE_PATH, page);
}

async function ensureShell() {
  if (await caches.match(OFFLINE_PATH, { cacheName: SHELL_CACHE })) return;
  // A failed fill leaves the browser's own offline page; the next navigation tries again.
  await fillShell().catch(() => undefined);
}

self.addEventListener('message', (event) => {
  if (event.data === REFILL_MESSAGE) event.waitUntil(ensureShell());
});

self.addEventListener('install', (event) => {
  event.waitUntil(fillShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    })(),
  );
});

async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    return preloaded ?? (await fetch(event.request));
  } catch (networkError) {
    const fallback = await caches.match(OFFLINE_PATH, { cacheName: SHELL_CACHE });
    if (!fallback) throw networkError;
    if (event.resultingClientId) fallbackClients.add(event.resultingClientId);
    return fallback;
  }
}

async function shellFile(request) {
  return (await caches.match(request, { cacheName: SHELL_CACHE })) ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    event.waitUntil(ensureShell());
    return;
  }
  // Every other request goes to the network untouched, unless it comes from
  // the fallback page or the device reports no network at all.
  if (fallbackClients.has(event.clientId) || !self.navigator.onLine) {
    event.respondWith(shellFile(request));
  }
});
