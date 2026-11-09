import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Rule test: the page clears the caches the service worker owns by their name
// prefix (sign-out, organization switch). A worker cache outside that prefix
// would survive both, so the two copies of the prefix must stay equal.
const root = join(import.meta.dir, '..', '..');
const worker = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
const pageSide = readFileSync(join(root, 'lib', 'offline', 'service-worker-caches.ts'), 'utf8');
const appShell = readFileSync(join(root, 'components', 'sidebar', 'app-shell.tsx'), 'utf8');

test('every cache the service worker opens carries the prefix the page clears', () => {
  const pagePrefix = pageSide.match(/const SERVICE_WORKER_CACHE_PREFIX = '([^']+)';/)?.[1];
  expect(pagePrefix).toBeDefined();
  expect(worker).toContain(`const CACHE_PREFIX = '${pagePrefix}';`);
  const opened = [...worker.matchAll(/caches\.open\(([^)]+)\)/g)].map(([, name]) => name);
  expect(opened).toEqual(['SHELL_CACHE']);
  expect(worker).toMatch(/const SHELL_CACHE = `\$\{CACHE_PREFIX\}/);
});

// Rule test: an organization switch deletes the shell and navigates on the
// client, so the app shell asks the worker to refill it. A message the worker
// does not know would leave the device without the offline fallback.
test('the shell refill message the page sends is the one the worker answers', () => {
  const pageMessage = appShell.match(/const SHELL_REFILL_MESSAGE = '([^']+)';/)?.[1];
  expect(pageMessage).toBeDefined();
  expect(worker).toContain(`const REFILL_MESSAGE = '${pageMessage}';`);
  expect(worker).toMatch(/event\.data === REFILL_MESSAGE\) event\.waitUntil\(ensureShell\(\)\)/);
});
