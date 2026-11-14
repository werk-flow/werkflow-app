import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceWorkerScript } from '@/lib/offline/service-worker-script';

// Rule test: the page clears the caches the service worker owns by their name
// prefix (sign-out, organization switch). A worker cache outside that prefix
// would survive both, so the two copies of the prefix must stay equal.
const root = join(import.meta.dir, '..', '..');
const worker = serviceWorkerScript(root, 'phase-production-build', { WERKFLOW_BUILD_ID: 'test-build' });
const pageSide = readFileSync(join(root, 'lib', 'offline', 'service-worker-caches.ts'), 'utf8');

test('every cache the service worker opens carries the prefix the page clears', () => {
  const pagePrefix = pageSide.match(/const SERVICE_WORKER_CACHE_PREFIX = '([^']+)';/)?.[1];
  expect(pagePrefix).toBeDefined();
  expect(worker).toContain(`const CACHE_PREFIX = '${pagePrefix}';`);
  const opened = [...worker.matchAll(/caches\.open\(([^)]+)\)/g)].map(([, name]) => name);
  expect(opened).toEqual(['SHELL_CACHE']);
  expect(worker).toMatch(/const SHELL_CACHE = `\$\{CACHE_PREFIX\}/);
});

// Rule test: a sign-in and an organization switch navigate on the client after
// the shell was deleted, so the page asks the worker to refill it. A message the
// worker does not know would leave the device without the offline fallback.
test('the shell refill message the page sends is the one the worker answers', () => {
  const pageMessage = pageSide.match(/const SHELL_REFILL_MESSAGE = '([^']+)';/)?.[1];
  expect(pageMessage).toBeDefined();
  expect(worker).toContain(`const REFILL_MESSAGE = '${pageMessage}';`);
  expect(worker).toMatch(/event\.data === REFILL_MESSAGE\) event\.waitUntil\(ensureShell\(\)\)/);
});

// Rule test: the worker caches every path SHELL_ASSET finds in the offline page,
// and one unfetchable path fails the whole install. A path inside another
// host's URL (a custom Supabase domain such as api.png.example.com, a CDN
// image) is not the app's file and must never match.
test('the shell asset pattern finds only root-relative paths of this origin', () => {
  const source = worker.match(/const SHELL_ASSET = \/(.+)\/g;/)?.[1];
  expect(source).toBeDefined();
  const shellAsset = new RegExp(source ?? '', 'g');
  const html = [
    '<link rel="preconnect" href="https://api.png.example.com">',
    '<img src="https://cdn.example.com/brand.svg">',
    '<script src="/_next/static/chunks/app-1a2b.js"></script>',
    '<img src="/logo-icon-light.svg" srcset="/icons/icon-192.png 1x">',
    'self.__next_f.push([1,"\\"/_next/static/css/app-3c4d.css\\""])',
  ].join('\n');
  expect([...new Set(html.match(shellAsset) ?? [])]).toEqual([
    '/_next/static/chunks/app-1a2b.js',
    '/logo-icon-light.svg',
    '/icons/icon-192.png',
    '/_next/static/css/app-3c4d.css',
  ]);
});

// Rule test: the shell requests send the origin's cookies, so a deployment
// behind Vercel Authentication answers them (werk-flow/werkflow-planning#22).
// The cached bytes stay free of the person only while proxy.ts, which reads
// and refreshes the session, never runs on a shell path.
test('the proxy never runs on a path the shell caches', () => {
  // Only a literal path or a literal prefix with `/:path*` can be judged here; any
  // other Next.js matcher form, such as `/(.*)`, fails until this test learns it.
  const judgeable = /^\/(?:[\w-]+(?:\/[\w-]+)*)?(?:\/:path\*)?$/;
  const block = /matcher: \[([^\]]*)\]/.exec(readFileSync(join(root, 'proxy.ts'), 'utf8'))?.[1];
  if (!block) throw new Error('matcher not found in proxy.ts');
  const entries = [...block.matchAll(/'([^']+)'/g)].flatMap(([, entry]) =>
    entry === undefined ? [] : [entry],
  );
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.filter((entry) => !judgeable.test(entry))).toEqual([]);
  const runsOn = (entry: string, path: string): boolean => {
    if (!entry.endsWith('/:path*')) return entry === path;
    const base = entry.slice(0, -'/:path*'.length);
    return path === base || path.startsWith(`${base}/`);
  };
  for (const path of [
    '/offline',
    '/sw.js',
    '/_next/static/chunks/app.js',
    '/icons/icon-192.png',
    '/logo.svg',
  ]) {
    expect(
      entries.filter((entry) => runsOn(entry, path)),
      `proxy.ts runs on ${path}`,
    ).toEqual([]);
  }
  expect(judgeable.test('/(.*)')).toBe(false);
});

// Rule test: a dynamic page could hold the person whose cookies the shell
// request sent. Next.js marks such a page private and no-store; the worker
// refuses to cache an offline page with that mark.
test('the worker refuses an offline page the server rendered for one request', () => {
  const source = worker.match(/const PER_REQUEST = \/(.+)\/i;/)?.[1];
  expect(source).toBeDefined();
  const perRequest = new RegExp(source ?? '', 'i');
  expect(perRequest.test('private, no-cache, no-store, max-age=0, must-revalidate')).toBe(true);
  expect(perRequest.test('no-store, must-revalidate')).toBe(true);
  expect(perRequest.test('public, max-age=0, must-revalidate')).toBe(false);
  expect(perRequest.test('s-maxage=31536000')).toBe(false);
  expect(worker).toMatch(/if \(PER_REQUEST\.test\(page\.headers\.get\('Cache-Control'\) \?\? ''\)\)\s+throw/);
});
