import { expect, test } from 'bun:test';
import { changedCheckPlan } from './changed-check';

test('formats and lints changed sources and runs the unit tests beside changed modules', () => {
  const existing = new Set(['lib/a/rule.test.ts', 'lib/b/view.test.tsx', 'lib/c/own.test.ts']);
  const plan = changedCheckPlan(
    [
      'lib/a/rule.ts',
      'lib/b/view.tsx',
      'lib/c/own.test.ts',
      'lib/d/untested.ts',
      'components/x.tsx',
      'docs/README.md',
      'package.json',
    ],
    (file) => existing.has(file),
  );
  expect(plan.unitTests).toEqual(['./lib/a/rule.test.ts', './lib/b/view.test.tsx', './lib/c/own.test.ts']);
  expect(plan.linted).toEqual([
    'lib/a/rule.ts',
    'lib/b/view.tsx',
    'lib/c/own.test.ts',
    'lib/d/untested.ts',
    'components/x.tsx',
  ]);
  expect(plan.formatted).toContain('package.json');
  expect(plan.formatted).not.toContain('docs/README.md');
});

test('a file outside lib/ runs the unit tests that name it or its folder by path', () => {
  const sources = new Map([
    ['lib/conventions/scripts.test.ts', "readRepositoryFile('package.json')"],
    ['lib/testing/specs.test.ts', "readdirSync(join(root, 'tests/audit'))"],
    ['lib/testing/unrelated.test.ts', "const name = 'tests';"],
  ]);
  const plan = (changed: string[]): string[] => changedCheckPlan(changed, () => false, sources).unitTests;
  // #386: a preload in a package script broke a convention test that check:changed never ran.
  expect(plan(['package.json'])).toEqual(['./lib/conventions/scripts.test.ts']);
  // #366: a new audit spec broke a convention test that scans tests/audit.
  expect(plan(['tests/audit/visual/acceptance-pages.spec.ts'])).toEqual(['./lib/testing/specs.test.ts']);
  expect(plan(['tests/golden/p1-01.spec.ts', 'docs/README.md'])).toEqual([]);
});

test('a change without sources runs no unit test', () => {
  expect(changedCheckPlan(['docs/README.md'], () => true)).toEqual({
    formatted: [],
    linted: [],
    unitTests: [],
  });
});
