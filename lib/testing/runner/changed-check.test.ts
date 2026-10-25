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

test('a change without sources runs no unit test', () => {
  expect(changedCheckPlan(['docs/README.md'], () => true)).toEqual({
    formatted: [],
    linted: [],
    unitTests: [],
  });
});
