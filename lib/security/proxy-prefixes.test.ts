import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tier 2 guard for SI-012: every authenticated route area must be routed by
// proxy.ts. The proxy runs on the edge and cannot read the file system, so the
// literal list is compared here against the app/(app) folders plus the two
// authenticated areas that live outside the group.

const repositoryRoot = resolve(import.meta.dir, '../..');
const authenticatedAreasOutsideGroup = ['/onboarding', '/upgrade'];

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
  return [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
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
  const matched = new Set(quotedEntries(block).map((entry) => entry.replace(/\/:path\*$/, '')));
  for (const prefix of expectedPrefixes()) {
    expect(matched.has(prefix), `${prefix} missing from the proxy matcher`).toBe(true);
  }
});
