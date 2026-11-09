import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_WORKER_CACHE_PREFIX } from '@/lib/offline/service-worker-caches';

// Rule test: the page clears the caches the service worker owns by their name
// prefix (sign-out, organization switch). A worker cache outside that prefix
// would survive both, so the two copies of the prefix must stay equal.
const worker = readFileSync(join(import.meta.dir, '..', '..', 'public', 'sw.js'), 'utf8');

test('every cache the service worker opens carries the prefix the page clears', () => {
  expect(worker).toContain(`const CACHE_PREFIX = '${SERVICE_WORKER_CACHE_PREFIX}';`);
  const opened = [...worker.matchAll(/caches\.open\(([^)]+)\)/g)].map(([, name]) => name);
  expect(opened).toEqual(['SHELL_CACHE']);
  expect(worker).toMatch(/const SHELL_CACHE = `\$\{CACHE_PREFIX\}/);
});
