// WerkFlow's service worker: the app shell that opens without signal.
//
// It keeps exactly one cache, the shell: the offline fallback page and the
// static build files that page loads. The fallback is a prerendered page the
// proxy never runs on, so its bytes are the same for every request and hold no
// user, organization or role. The shell requests send the origin's cookies,
// because a deployment behind Vercel Authentication (staging) redirects every
// request without its own cookie, and a redirect or a page marked private or
// no-store fails the fill instead of entering the cache. A navigation goes to
// the network unchanged; only when the network fails does the worker answer
// with the fallback. A request for a shell file (a build file or an image of
// public/) is answered from the shell when the shell holds it, whichever page
// asked: a cold start on a phone without signal may leave the worker no sign
// that the page is its fallback. Every other request goes to the network
// untouched. It never writes a response it did not request itself, so no RSC,
// API or authenticated page ever enters the cache.
//
// The page clears every cache whose name starts with CACHE_PREFIX on sign-out
// and on an organization switch (lib/offline/service-worker-caches.ts owns the
// same prefix; lib/security/service-worker.test.ts pins both). The next
// navigation fills the shell again. A signed-in page that navigates on the
// client sends REFILL_MESSAGE instead, so the fallback is back before the
// signal goes.
//
// This file is the worker's source, not the served script. The build puts
// `const SHELL_VERSION = "<build id>";` in front of it and serves the result
// at /sw.js (lib/offline/service-worker-script.ts, app/sw.js/route.ts). Each
// deployed build therefore serves different bytes, the browser installs the
// new worker on its next check, and its activation deletes the old shell.

const CACHE_PREFIX = 'werkflow-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${SHELL_VERSION}`;
const OFFLINE_PATH = '/offline';
const REFILL_MESSAGE = 'werkflow:refill-shell';
// Same-origin files the fallback page references: the build's hashed files
// and the logos and icons under public/, folders included. Escaped quotes inside the streamed
// RSC payload end a match the same way plain quotes do. A match starts only
// where a root-relative path can: never after a host name or another path
// segment, so `https://api.png.example.com` or `https://cdn.example.com/a.svg`
// yields nothing (an unfetchable path would fail the whole install).
const SHELL_ASSET = /(?<![\w.:/-])\/(?:_next\/static\/[^"'\s\\)]+|(?:[\w-]+\/)*[\w-]+\.(?:svg|png))/g;
// The path of a file SHELL_ASSET can store. A deployment asks for it with a
// query of its own (Vercel's `?dpl=…` on a public image), which the stored
// copy lacks; the file is the same, so the shell answers it without the query.
const SHELL_FILE = /^\/(?:_next\/static\/|(?:[\w-]+\/)*[\w-]+\.(?:svg|png)$)/;

// A response the server rendered for one request says so (Next.js marks a dynamic page private, no-store).
const PER_REQUEST = /\b(?:private|no-store)\b/i;

async function fillShell() {
  const page = await fetch(OFFLINE_PATH, {
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  });
  if (!page.ok) throw new Error(`The offline page answered ${page.status}.`);
  if (PER_REQUEST.test(page.headers.get('Cache-Control') ?? ''))
    throw new Error('The offline page is not static.');
  const html = await page.clone().text();
  const assets = [...new Set(html.match(SHELL_ASSET) ?? [])];
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(
    assets.map((path) => new Request(path, { credentials: 'same-origin', redirect: 'error' })),
  );
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
    return fallback;
  }
}

/** The shell's copy of a build file or public image; the network when the shell does not hold it. */
async function shellFile(request) {
  return (await caches.match(request, { cacheName: SHELL_CACHE, ignoreSearch: true })) ?? fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(event));
    event.waitUntil(ensureShell());
    return;
  }
  // A build file's name is its content, and the shell is this build's, so its copy is the file.
  if (SHELL_FILE.test(url.pathname)) event.respondWith(shellFile(request));
});
