import { describe, expect, test } from 'bun:test';

import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';
import { effectiveLintRules } from './effective-lint-rules';
import { readTypeAssertionRatchet } from './type-assertions';

// Planted-violation probes for the type-aware rules of eslint.config.mjs and
// the assertion ban. Each rule must fail its planted violation in product
// code, tests and scripts, and pass the correct form.

const eslint = createProbeLinter({ typed: true });

async function ruleMessages(ruleId: string, source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  const fatal = (result?.messages ?? []).filter((message) => message.fatal);
  expect(fatal.map(({ message }) => message)).toEqual([]);
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === ruleId)
    .map(({ message }) => message);
}

const PROBE_PATHS = [
  'lib/typed-lint-probe.ts',
  'lib/typed-lint-probe.test.ts',
  'scripts/typed-lint-probe.ts',
];

describe('type-aware lint rules', () => {
  test('a switch over a union names every member; a default does not stand in for one', async () => {
    const unionSwitch = (cases: string): string =>
      `type Kind = 'a' | 'b';\nexport function label(kind: Kind): string {\n  switch (kind) {\n${cases}\n  }\n}\n`;
    for (const filePath of PROBE_PATHS) {
      const rule = '@typescript-eslint/switch-exhaustiveness-check';
      expect(
        await ruleMessages(
          rule,
          unionSwitch("    case 'a': return 'A';\n    default: return '?';"),
          filePath,
        ),
      ).toHaveLength(1);
      expect(
        await ruleMessages(
          rule,
          unionSwitch("    case 'a': return 'A';\n    case 'b': return 'B';"),
          filePath,
        ),
      ).toEqual([]);
      expect(
        await ruleMessages(
          rule,
          unionSwitch(
            "    case 'a': return 'A';\n    case 'b': return 'B';\n    default: {\n      const unhandled: never = kind;\n      return unhandled;\n    }",
          ),
          filePath,
        ),
      ).toEqual([]);
    }
  });

  test('a typed probe at an existing path keeps the type-aware rules and reports its typed configuration', async () => {
    const rule = '@typescript-eslint/no-floating-promises';
    const floating =
      'async function load(): Promise<number> {\n  return 1;\n}\nexport function start(): void {\n  load();\n}\n';
    expect(await ruleMessages(rule, floating, 'lib/utils.ts')).toHaveLength(1);
    const rules = effectiveLintRules(await eslint.calculateConfigForFile('lib/utils.ts'));
    expect(rules[rule]?.[0]).toBe(2);
  });

  test('a promise is awaited, handled or voided; Bun mock.module is a known safe call', async () => {
    const rule = '@typescript-eslint/no-floating-promises';
    const load = 'async function load(): Promise<number> {\n  return 1;\n}\n';
    for (const filePath of PROBE_PATHS) {
      expect(
        await ruleMessages(rule, `${load}export function start(): void {\n  load();\n}\n`, filePath),
      ).toHaveLength(1);
      expect(
        await ruleMessages(
          rule,
          `${load}export function start(): void {\n  load().then(() => undefined);\n}\n`,
          filePath,
        ),
      ).toHaveLength(1);
      expect(
        await ruleMessages(
          rule,
          `${load}export async function start(): Promise<void> {\n  await load();\n}\n`,
          filePath,
        ),
      ).toEqual([]);
      expect(
        await ruleMessages(rule, `${load}export function start(): void {\n  void load();\n}\n`, filePath),
      ).toEqual([]);
    }
    expect(
      await ruleMessages(
        rule,
        "import { mock } from 'bun:test';\n\nmock.module('@/lib/probe', () => ({ value: 1 }));\n",
        'lib/typed-lint-probe.test.ts',
      ),
    ).toEqual([]);
  });

  test('a type assertion fails outside the ratchet; `as const` passes', async () => {
    const rule = '@typescript-eslint/consistent-type-assertions';
    for (const filePath of [
      ...PROBE_PATHS,
      'components/typed-lint-probe.tsx',
      'tests/golden/support/typed-lint-probe.ts',
    ]) {
      expect(
        await ruleMessages(rule, 'export const width = JSON.parse("1") as number;\n', filePath),
      ).toHaveLength(1);
      expect(await ruleMessages(rule, "export const kinds = ['a', 'b'] as const;\n", filePath)).toEqual([]);
    }
  });

  test('an annotation on an any value fails in product code, tests and scripts; a parsed or narrowed value passes', async () => {
    const rule = '@typescript-eslint/no-unsafe-assignment';
    const entries = "import { z } from '@/lib/zod';\n\ntype Detail = { entries?: string[] } | null;\n";
    const detailSchema =
      'const detailSchema = z.object({ entries: z.array(z.string()).optional() }).nullable();\n';
    for (const filePath of [
      ...PROBE_PATHS,
      'components/typed-lint-probe.tsx',
      'hooks/typed-lint-probe.ts',
      'app/typed-lint-probe.tsx',
      'lib/testing/typed-lint-probe.ts',
      'tests/golden/support/typed-lint-probe.ts',
      'tests/canary/typed-lint-probe.spec.ts',
    ]) {
      expect(
        await ruleMessages(
          rule,
          `${entries}export function read(event: CustomEvent): Detail {\n  const detail: Detail = event.detail;\n  return detail;\n}\n`,
          filePath,
        ),
      ).toHaveLength(1);
      expect(
        await ruleMessages(
          rule,
          'export function width(text: string): number {\n  const value: number = JSON.parse(text);\n  return value;\n}\n',
          filePath,
        ),
      ).toHaveLength(1);
      expect(
        await ruleMessages(
          rule,
          `${entries}${detailSchema}export function read(event: CustomEvent): Detail {\n  const detail = detailSchema.parse(event.detail);\n  return detail;\n}\n`,
          filePath,
        ),
      ).toEqual([]);
      expect(
        await ruleMessages(
          rule,
          "export function width(text: string): number {\n  const value: unknown = JSON.parse(text);\n  return typeof value === 'number' ? value : 0;\n}\n",
          filePath,
        ),
      ).toEqual([]);
    }
  });

  test('a file on the ratchet keeps its recorded assertions without a lint error', async () => {
    const [listed] = Object.keys(readTypeAssertionRatchet());
    if (listed === undefined) return;
    expect(
      await ruleMessages(
        '@typescript-eslint/consistent-type-assertions',
        'export const width = JSON.parse("1") as number;\n',
        listed,
      ),
    ).toEqual([]);
  });
});
