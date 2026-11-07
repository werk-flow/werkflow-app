import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { measureFunctions } from '../../eslint-rules/function-size.mjs';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';
import {
  COMPONENT_FILE_LINE_LIMIT,
  FUNCTION_LINE_LIMIT,
  MODULE_LINE_LIMIT,
} from '../../eslint-rules/size-caps.mjs';
import { z } from '@/lib/zod';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for the size caps (AGENTS.md "4. Code quality and maintainability").
// The caps in eslint-rules/size-caps.mjs apply to every product file through
// max-lines and quality/function-size, with no exempt module or function. A
// suppression with a reason would pass the lint gate, so a directive that
// names a size rule fails here.

const measuredFunctionsSchema = z.array(z.object({ key: z.string(), lines: z.number() }));
type MeasuredFunction = z.infer<typeof measuredFunctionsSchema>[number];

const SIZE_RULE_DIRECTIVE =
  /eslint-disable(?:-next-line|-line)?\b[^\n]*\b(?:max-lines(?:-per-function)?|quality\/function-size)\b/;

const eslint = createProbeLinter();

/** Every function of a source with its key and size, measured as quality/function-size measures. */
function measureSource(source: string, file: string): MeasuredFunction[] {
  const measured: MeasuredFunction[] = [];
  const plugin = {
    rules: {
      measure: {
        create: (context: { sourceCode: unknown }) => ({
          'Program:exit': () => {
            const functions = measuredFunctionsSchema.parse(measureFunctions(context.sourceCode));
            for (const { key, lines } of functions) measured.push({ key, lines });
          },
        }),
      },
    },
  };
  const messages = new Linter({ configType: 'flat' }).verify(
    source,
    [
      {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { size: plugin },
        rules: { 'size/measure': 'error' },
      },
    ],
    { filename: file },
  );
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file} does not parse: ${fatal.message}`);
  return measured;
}

/** A function of exactly `lines` measured lines. */
function functionOfLines(name: string, lines: number): string {
  const body = Array.from({ length: lines - 3 }, (_, index) => `  const value${index} = ${index};`);
  return [`export function ${name}(): number {`, ...body, '  return 0;', '}', ''].join('\n');
}

/** A module of exactly `lines` raw lines. */
function moduleOfLines(lines: number): string {
  return 'export const line = 1;\n'.repeat(lines);
}

/** The messages one rule reports for a planted source, linted with the repository's configuration. */
async function reported(rule: string, source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  const messages = result?.messages ?? [];
  expect(messages.filter((message) => message.fatal).map((message) => message.message)).toEqual([]);
  return messages.filter((message) => message.ruleId === rule).map((message) => message.message);
}

describe('size caps', () => {
  test('no product file switches a size limit off', () => {
    const offenders = listProductSources().filter((file) =>
      SIZE_RULE_DIRECTIVE.test(readFileSync(resolve(repositoryRoot, file), 'utf8')),
    );
    expect(offenders, 'Split the file or function instead of disabling a size rule.').toEqual([]);
  });

  test('a function is keyed by its name chain, never by its line', () => {
    const source = [
      'export function Outer() {',
      '  const handler = useCallback(() => 1, []);',
      '  useEffect(() => undefined, []);',
      '  useEffect(() => undefined, [handler]);',
      '  return items.map((item) => item);',
      '}',
      'const Inner = () => 0;',
      'class Probe { method() { return 1; } }',
      '',
    ].join('\n');
    expect(measureSource(source, 'lib/probe.ts').map(({ key }) => key)).toEqual([
      'Outer',
      'Outer > handler',
      'Outer > useEffect#1',
      'Outer > useEffect#2',
      'Outer > map#1',
      'Inner',
      'method',
    ]);
  });

  test('a module over its cap fails lint; one at its cap passes (planted)', async () => {
    for (const [filePath, limit] of [
      ['lib/size-cap-probe.ts', MODULE_LINE_LIMIT],
      ['components/size-cap-probe.tsx', COMPONENT_FILE_LINE_LIMIT],
      ['app/(app)/size-cap-probe/page.tsx', COMPONENT_FILE_LINE_LIMIT],
    ] as const) {
      expect(await reported('max-lines', moduleOfLines(limit + 1), filePath), filePath).toHaveLength(1);
      expect(await reported('max-lines', moduleOfLines(limit), filePath), filePath).toEqual([]);
    }
  });

  test('a function over the cap fails lint; one at the cap passes (planted)', async () => {
    for (const filePath of ['lib/size-cap-probe.ts', 'components/size-cap-probe.tsx']) {
      const over = await reported(
        'quality/function-size',
        functionOfLines('probe', FUNCTION_LINE_LIMIT + 1),
        filePath,
      );
      expect(over, filePath).toHaveLength(1);
      expect(over[0]).toContain(`"probe" has ${FUNCTION_LINE_LIMIT + 1} lines`);
      expect(
        await reported('quality/function-size', functionOfLines('probe', FUNCTION_LINE_LIMIT), filePath),
        filePath,
      ).toEqual([]);
    }
  });
});
