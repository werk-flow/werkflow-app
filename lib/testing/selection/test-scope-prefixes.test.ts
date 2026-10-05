// Rule test: every scope prefix exists and every hook has one feature owner.
import { expect, test } from 'bun:test';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { scopeEntryOwns, TEST_SCOPE_PREFIXES } from './test-groups';

const repositoryRoot = resolve(import.meta.dir, '../../..');

function owners(file: string): string[] {
  return Object.entries(TEST_SCOPE_PREFIXES)
    .filter(([, entries]) => entries.some((entry) => scopeEntryOwns(entry, file)))
    .map(([scope]) => scope);
}

// A scope entry that names nothing owns nothing, so the code it was meant to own
// selects only the core set (lib/customers/ versus lib/clients/, found
// 2026-09-14). A renamed feature folder or file must update the registry.
test('every directory entry is an existing directory and every file entry an existing file', () => {
  const missing = Object.entries(TEST_SCOPE_PREFIXES).flatMap(([scope, entries]) =>
    entries
      .filter((entry) => {
        const path = resolve(repositoryRoot, entry);
        if (!existsSync(path)) return true;
        return entry.endsWith('/') ? !statSync(path).isDirectory() : !statSync(path).isFile();
      })
      .map((entry) => `${scope}: ${entry}`),
  );
  expect(missing).toEqual([]);
});

test('a file entry owns exactly that file and a directory entry owns its subtree', () => {
  expect(scopeEntryOwns('hooks/use-active-jobs.ts', 'hooks/use-active-jobs.ts')).toBe(true);
  expect(scopeEntryOwns('hooks/use-active-jobs.ts', 'hooks/use-active-jobs.tsx')).toBe(false);
  expect(scopeEntryOwns('lib/jobs/', 'lib/jobs/actions.ts')).toBe(true);
  expect(scopeEntryOwns('lib/jobs/', 'lib/jobs-archive/actions.ts')).toBe(false);
});

// hooks/ has no directory owner: a feature hook registered nowhere would select only
// the core set although its feature's groups exercise it.
test('every hook is either registered under one feature scope or listed as shared', () => {
  const sharedHooks = new Set([
    'use-batch-progress.ts',
    'use-business-day-refresh.ts',
    'use-busy-id.ts',
    'use-hydrated.ts',
    'use-list-navigation.ts',
    'use-live-view.ts',
    'use-optimistic-channel.ts',
    'use-optimistic-list.ts',
    'use-realtime-router-refresh.ts',
    'use-report-pending.ts',
    'use-server-action.ts',
    'use-settle-on-change.ts',
    // The sign-out hook belongs to the authentication row of the core set (group-selection.ts).
    'use-sign-out.ts',
  ]);
  const problems = readdirSync(resolve(repositoryRoot, 'hooks'))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name))
    .flatMap((name) => {
      const scopes = owners(`hooks/${name}`);
      if (sharedHooks.has(name))
        return scopes.length ? [`${name} is listed as shared but owned by ${scopes.join(', ')}`] : [];
      return scopes.length === 1 ? [] : [`${name} needs exactly one feature scope or the shared list`];
    });
  expect(problems).toEqual([]);
});
