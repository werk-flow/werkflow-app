import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  namedMechanisms,
  repositoryMechanismIndex,
  tierClaimProblem,
  type MechanismIndex,
} from './incident-mechanisms';

const index: MechanismIndex = {
  fileExists: (path) => ['lib/a.test.ts', 'app/(app)/kalender/page.tsx', '.githooks/pre-push'].includes(path),
  lintRules: new Set(['playwright-spec/no-raw-key-press']),
  selectorSets: new Set(['specSelectors']),
  groupIds: new Set(['sql:security', 'audit:wave-2:p1-15']),
};

test('a Tier 1 or Tier 2 claim names a mechanism that exists', () => {
  // The 2026-10-15 misuse: a code repair called Tier 1 without any mechanism behind it.
  expect(tierClaimProblem('Tier 1: load() returns a promise that settles with the read', index)).toContain(
    'names its mechanism',
  );
  expect(tierClaimProblem('Tier 2: a check refuses it', index)).toContain('names its mechanism');
  for (const resolvable of [
    'Tier 2: lib/a.test.ts refuses it',
    'Tier 1: the route app/(app)/kalender/page.tsx owns it',
    'Tier 1: .githooks/pre-push refuses it',
    'Tier 2: lint playwright-spec/no-raw-key-press',
    'Tier 2, the specSelectors set',
    'Tier 2: audit:wave-2:p1-15 fails on it',
    'Tier 2: the settle step fails (sql:security)',
  ])
    expect(tierClaimProblem(resolvable, index)).toBeNull();
  // A cited path that does not exist breaks the claim even next to one that does.
  expect(tierClaimProblem('Tier 2: lib/a.test.ts and lib/gone.test.ts', index)).toContain('lib/gone.test.ts');
  // Unknown rule ids, selector sets and groups do not resolve.
  expect(tierClaimProblem('Tier 2: lint ui/no-such-rule, otherSelectors, audit:none', index)).toContain(
    'names its mechanism',
  );
});

test('only a claim is checked: Tier 3, no claim, and "Tier 1 and 2 cannot reach it" pass', () => {
  for (const prevention of [
    'Tier 3: a host network change is outside the product',
    'no prevention claim: one observation',
    'Tier 3: the helper owns it. Tier 1 and 2 cannot reach the cause',
    'no prevention claim; a recurrence would make it a harness repair (Tier 2 harness)',
  ])
    expect(tierClaimProblem(prevention, index)).toBeNull();
});

test('paths are cut out before rule ids are read, so a path segment is no lint rule', () => {
  expect(namedMechanisms('Tier 2: lib/a.test.ts', index)).toEqual({
    resolved: ['lib/a.test.ts'],
    missingPaths: [],
  });
});

test('the repository index knows the configured rules, selector sets and groups', () => {
  const repository = repositoryMechanismIndex(resolve(import.meta.dir, '../../..'));
  expect(repository.lintRules.has('playwright-spec/no-raw-key-press')).toBe(true);
  expect(repository.selectorSets.has('specSelectors')).toBe(true);
  expect(repository.groupIds.has('sql:security')).toBe(true);
  expect(repository.fileExists('lib/testing/runs/incident-mechanisms.ts')).toBe(true);
  // A path that leaves the repository is no mechanism of it.
  expect(repository.fileExists('../werkflow-app/package.json')).toBe(false);
});
