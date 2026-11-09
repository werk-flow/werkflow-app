import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Rule test: the page clears the caches the service worker owns by their name
// prefix (sign-out, organization switch). A worker cache outside that prefix
// would survive both, so the two copies of the prefix must stay equal.
const root = join(import.meta.dir, '..', '..');
const worker = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
const pageSide = readFileSync(join(root, 'lib', 'offline', 'service-worker-caches.ts'), 'utf8');

test('every cache the service worker opens carries the prefix the page clears', () => {
  const pagePrefix = pageSide.match(/const SERVICE_WORKER_CACHE_PREFIX = '([^']+)';/)?.[1];
  expect(pagePrefix).toBeDefined();
  expect(worker).toContain(`const CACHE_PREFIX = '${pagePrefix}';`);
  const opened = [...worker.matchAll(/caches\.open\(([^)]+)\)/g)].map(([, name]) => name);
  expect(opened).toEqual(['SHELL_CACHE']);
  expect(worker).toMatch(/const SHELL_CACHE = `\$\{CACHE_PREFIX\}/);
});
