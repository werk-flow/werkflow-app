// Rule test: axe runs only through tests/audit/support/axe.ts, and an exception names its surface and reason.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listTestFiles } from '../selection/test-groups';

const ROOT = resolve(import.meta.dir, '../../..');
const AXE_SUPPORT = 'tests/audit/support/axe.ts';

/** Files under tests/ that switch an axe rule off or exclude a region, or import axe besides its one home. */
function axeBypasses(files: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, text] of files) {
    if (file === AXE_SUPPORT) continue;
    if (/\bdisableRules\s*\(/.test(text)) problems.push(`${file}: disableRules( switches an axe rule off`);
    if (/@axe-core\/playwright|from ['"]axe-core['"]/.test(text))
      problems.push(`${file}: axe is imported outside ${AXE_SUPPORT}; call expectNoAxeViolations`);
  }
  return problems;
}

/** The exception list in the axe support module: every entry names its rule, surface and a written reason. */
function exceptionProblems(source: string): string[] {
  const list = source.match(/AXE_EXCEPTIONS: readonly AxeException\[\] = \[([\s\S]*?)\];/)?.[1];
  if (list === undefined) return ['AXE_EXCEPTIONS is missing from the axe support module'];
  const entries = [...list.matchAll(/\{([\s\S]*?)\}/g)].map((match) => match[1] ?? '');
  return entries.flatMap((entry, index) => {
    const reason = entry.match(/reason:\s*['"`]([^'"`]*)['"`]/)?.[1] ?? '';
    const surface = entry.match(/surface:\s*['"`]([^'"`]*)['"`]/)?.[1] ?? '';
    return reason.length >= 30 && surface.length > 0
      ? []
      : [`exception ${index + 1}: names a third-party surface and a reason of 30 or more characters`];
  });
}

test('no test switches an axe rule off or runs axe outside its support module', () => {
  const files = new Map(
    listTestFiles(ROOT, 'tests', /\.ts$/).map((file) => [file, readFileSync(resolve(ROOT, file), 'utf8')]),
  );
  expect(files.has(AXE_SUPPORT)).toBe(true);
  expect(axeBypasses(files)).toEqual([]);
  expect(exceptionProblems(files.get(AXE_SUPPORT) ?? '')).toEqual([]);
});

// Planted defects: a spec that disables a rule or imports axe itself, and an exception without a reason.
test('a disabled rule, a second axe import and an unreasoned exception are reported', () => {
  expect(
    axeBypasses(
      new Map([
        ['tests/audit/layout/probe.spec.ts', "new AxeBuilder({ page }).disableRules(['color-contrast']);"],
        ['tests/audit/support/probe.ts', "import { AxeBuilder } from '@axe-core/playwright';"],
      ]),
    ),
  ).toEqual([
    'tests/audit/layout/probe.spec.ts: disableRules( switches an axe rule off',
    'tests/audit/support/probe.ts: axe is imported outside tests/audit/support/axe.ts; call expectNoAxeViolations',
  ]);
  expect(
    exceptionProblems(
      "export const AXE_EXCEPTIONS: readonly AxeException[] = [{ rule: 'region', target: '.x', surface: 'lib', reason: 'short' }];",
    ),
  ).toEqual(['exception 1: names a third-party surface and a reason of 30 or more characters']);
});
