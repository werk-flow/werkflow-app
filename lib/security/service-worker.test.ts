import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Rule test: the page clears the caches the service worker owns by their name
// prefix (sign-out, organization switch). A worker cache outside that prefix
// would survive both, so the two copies of the prefix must stay equal.
const root = join(import.meta.dir, '..', '..');
const worker = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
const pageSide = readFileSync(join(root, 'lib', 'offline', 'service-worker-caches.ts'), 'utf8');
const pageMessageSource = readFileSync(join(root, 'lib', 'service-worker-message.ts'), 'utf8');

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
  const pageMessage = pageMessageSource.match(/const SHELL_REFILL_MESSAGE = '([^']+)';/)?.[1];
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
