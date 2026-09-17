import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Security Tier 2: widening an authorization snapshot's lifetime needs review.
test('read-request scopes stay confined to the reviewed GET handlers and identity readers', () => {
  const root = resolve(import.meta.dir, '../..');
  const scopeOwners: string[] = [];
  const readerOwners: string[] = [];
  for (const directory of ['app', 'lib']) {
    for (const relative of new Bun.Glob('**/*.{ts,tsx}').scanSync({ cwd: resolve(root, directory) })) {
      const path = `${directory}/${relative.replaceAll('\\', '/')}`;
      if (path.includes('/fixtures/') || path.endsWith('.test.ts') || path === 'lib/data/read-request-cache.ts') continue;
      const source = readFileSync(resolve(root, path), 'utf8');
      if (/withReadRequest\s*\(/.test(source)) {
        scopeOwners.push(path);
        expect(source).toMatch(/export async function GET\(request: Request\)/);
        expect(source).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
      }
      if (/memoizeRequestRead\s*\(/.test(source)) {
        readerOwners.push(path);
        const names = [...source.matchAll(/export const (\w+) = memoizeRequestRead\(/g)].map((match) => match[1]);
        expect(names).toEqual(path === 'lib/data/cached.ts'
          ? ['getAuthenticatedUser', 'getCachedMemberships', 'getCachedPrestartMemberships']
          : ['loadResponsibilityRuntimeState']);
        if (path === 'lib/responsibilities/server.ts') expect(source).toContain("{ outsideRequest: 'fresh' }");
      }
    }
  }
  expect(scopeOwners.sort()).toEqual(['app/api/attention-counts/route.ts', 'app/api/background-read/route.ts', 'app/api/calendar-window/route.ts', 'app/api/customer-page/route.ts', 'app/api/time-tracking-state/route.ts']);
  expect(readerOwners.sort()).toEqual(['lib/data/cached.ts', 'lib/responsibilities/server.ts']);
});
