import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tier 2 guard for SI-012: every authenticated route area must be routed by
// proxy.ts. The proxy runs on the edge and cannot read the file system, so the
// literal list is compared here against the app/(app) folders plus the
// authenticated areas that live outside the group, each with its folder.

const repositoryRoot = resolve(import.meta.dir, '../..');
const areaFoldersOutsideGroup: Readonly<Record<string, string>> = {
  '/onboarding': 'app/onboarding',
  '/upgrade': 'app/upgrade',
  '/support': 'app/(support)/support',
};
const authenticatedAreasOutsideGroup = Object.keys(areaFoldersOutsideGroup);

function readProxySource(): string {
  return readFileSync(resolve(repositoryRoot, 'proxy.ts'), 'utf8');
}

function expectedPrefixes(): string[] {
  const folders = readdirSync(resolve(repositoryRoot, 'app/(app)'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `/${entry.name}`);
  return [...folders, ...authenticatedAreasOutsideGroup].sort();
}

function quotedEntries(block: string): string[] {
  return [...block.matchAll(/'([^']+)'/g)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

test('PROTECTED_PREFIXES covers every authenticated route area', () => {
  const source = readProxySource();
  const block = /PROTECTED_PREFIXES = \[([^\]]*)\]/.exec(source)?.[1];
  if (!block) throw new Error('PROTECTED_PREFIXES not found in proxy.ts');
  expect(quotedEntries(block).sort()).toEqual(expectedPrefixes());
});

test('the proxy matcher routes every protected prefix', () => {
  const source = readProxySource();
  const block = /matcher: \[([^\]]*)\]/.exec(source)?.[1];
  if (!block) throw new Error('matcher not found in proxy.ts');
  const entries = new Set(quotedEntries(block));
  for (const prefix of expectedPrefixes()) {
    // An area with nested pages needs the wildcard, or its subroutes never reach the
    // proxy: Step 3 (2026-09-13) found /zeiterfassung listed bare with four subroutes.
    const folder = areaFoldersOutsideGroup[prefix] ?? `app/(app)${prefix}`;
    // Route groups and private folders (`(group)`, `_lib`) are not subroutes.
    const nested = readdirSync(resolve(repositoryRoot, folder), { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && !/^[_(]/.test(entry.name),
    );
    const expected = nested ? `${prefix}/:path*` : prefix;
    expect(
      entries.has(expected) || entries.has(`${prefix}/:path*`),
      `${expected} missing from the proxy matcher`,
    ).toBe(true);
  }
});
