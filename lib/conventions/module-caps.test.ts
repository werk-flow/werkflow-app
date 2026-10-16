import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint, Linter } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { measureFunctions } from '../../eslint-rules/function-size.mjs';
import { qualityRules } from '../../eslint-rules/quality-rules.mjs';
import {
  FUNCTION_LINE_LIMIT,
  MODULE_LINE_LIMIT,
  SIZE_CAP_EXCEPTIONS,
} from '../../eslint-rules/size-caps.mjs';
import { listProductSources, repositoryRoot } from './product-sources';

// Tier 2 for the size caps (AGENTS.md "4. Code quality and maintainability").
// The caps in eslint-rules/size-caps.mjs apply to every product file through
// max-lines and quality/function-size. The modules and functions that predate
// them are listed in eslint-rules/size-cap-exceptions.json with their current
// size as their ceiling. This test keeps that list shrinking: an entry whose
// file or function is gone, back under the cap, or shorter than its ceiling
// fails until the entry is removed or lowered. A suppression with a reason
// would pass the lint gate, so a directive that names a size rule fails too.

type SizeCapExceptions = {
  /** The reason of each entry: the longest matching path prefix, otherwise `default`. */
  reasons: Record<string, string>;
  modules: Record<string, number>;
  functions: Record<string, Record<string, number>>;
};
type MeasuredFunction = { key: string; lines: number };

const exceptions: SizeCapExceptions = SIZE_CAP_EXCEPTIONS;

const SIZE_RULE_DIRECTIVE =
  /eslint-disable(?:-next-line|-line)?\b[^\n]*\b(?:max-lines(?:-per-function)?|quality\/function-size)\b/;

/** Every function of a source with its key and size, measured as quality/function-size measures. */
function measureSource(source: string, file: string): MeasuredFunction[] {
  const measured: MeasuredFunction[] = [];
  const plugin = {
    rules: {
      measure: {
        create: (context: { sourceCode: unknown }) => ({
          'Program:exit': () => {
            for (const { key, lines } of measureFunctions(context.sourceCode)) measured.push({ key, lines });
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

/** The raw line count max-lines reports for a source. */
function rawLines(source: string): number {
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

/** The problems of the exception list against the sources: each entry must be current. */
function staleEntries(list: SizeCapExceptions, read: (file: string) => string | null): string[] {
  const problems: string[] = [];
  if (!list.reasons.default) problems.push('reasons: the default reason is missing');
  const listedFiles = [...Object.keys(list.modules), ...Object.keys(list.functions)];
  for (const prefix of Object.keys(list.reasons)) {
    if (prefix !== 'default' && !listedFiles.some((file) => file.startsWith(prefix)))
      problems.push(`reasons: no entry under ${prefix}; remove its reason`);
  }
  for (const [file, ceiling] of Object.entries(list.modules)) {
    const source = read(file);
    if (source === null) {
      problems.push(`${file}: the module is gone; remove its entry`);
      continue;
    }
    const lines = rawLines(source);
    if (lines <= MODULE_LINE_LIMIT)
      problems.push(`${file}: ${lines} lines, back under the cap; remove its entry`);
    else if (lines < ceiling) problems.push(`${file}: ${lines} lines; lower its ceiling from ${ceiling}`);
  }
  for (const [file, functions] of Object.entries(list.functions)) {
    const source = read(file);
    const measured = new Map(
      source === null ? [] : measureSource(source, file).map(({ key, lines }) => [key, lines]),
    );
    for (const [key, ceiling] of Object.entries(functions)) {
      const lines = measured.get(key);
      if (lines === undefined) {
        problems.push(`${file} ${key}: the function is gone or renamed; remove its entry`);
      } else if (lines <= FUNCTION_LINE_LIMIT) {
        problems.push(`${file} ${key}: ${lines} lines, back under the cap; remove its entry`);
      } else if (lines < ceiling) {
        problems.push(`${file} ${key}: ${lines} lines; lower its ceiling from ${ceiling}`);
      }
    }
  }
  return problems;
}

function readRepositoryFile(file: string): string | null {
  const path = resolve(repositoryRoot, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** A function of exactly `lines` measured lines. */
function functionOfLines(name: string, lines: number): string {
  const body = Array.from({ length: lines - 3 }, (_, index) => `  const value${index} = ${index};`);
  return [`export function ${name}(): number {`, ...body, '  return 0;', '}', ''].join('\n');
}

describe('size caps', () => {
  test('no product file switches a size limit off', () => {
    const offenders = listProductSources().filter((file) =>
      SIZE_RULE_DIRECTIVE.test(readFileSync(resolve(repositoryRoot, file), 'utf8')),
    );
    expect(offenders, 'Split the file or function instead of disabling a size rule.').toEqual([]);
  });

  test('every listed module and function is still over its cap and at its ceiling', () => {
    expect(staleEntries(exceptions, readRepositoryFile)).toEqual([]);
  });

  test('the stale-entry check refuses a gone, shrunk or recovered entry (planted)', () => {
    const sources: Record<string, string> = {
      'lib/probe-module.ts': 'export const line = 1;\n'.repeat(MODULE_LINE_LIMIT + 5),
      'lib/probe-functions.ts': [
        functionOfLines('atCeiling', 90),
        functionOfLines('shrunk', 85),
        functionOfLines('recovered', 70),
      ].join('\n'),
    };
    const planted: SizeCapExceptions = {
      reasons: { 'lib/probe-': 'probe', 'components/gone/': 'a reason nothing uses' },
      modules: {
        'lib/probe-module.ts': MODULE_LINE_LIMIT + 9,
        'lib/probe-gone.ts': 900,
      },
      functions: {
        'lib/probe-functions.ts': { atCeiling: 90, shrunk: 88, recovered: 95, missing: 99 },
        'lib/probe-gone.ts': { anything: 99 },
      },
    };
    expect(staleEntries(planted, (file) => sources[file] ?? null)).toEqual([
      'reasons: the default reason is missing',
      'reasons: no entry under components/gone/; remove its reason',
      `lib/probe-module.ts: ${MODULE_LINE_LIMIT + 5} lines; lower its ceiling from ${MODULE_LINE_LIMIT + 9}`,
      'lib/probe-gone.ts: the module is gone; remove its entry',
      'lib/probe-functions.ts shrunk: 85 lines; lower its ceiling from 88',
      'lib/probe-functions.ts recovered: 70 lines, back under the cap; remove its entry',
      'lib/probe-functions.ts missing: the function is gone or renamed; remove its entry',
      'lib/probe-gone.ts anything: the function is gone or renamed; remove its entry',
    ]);
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

  test('quality/function-size refuses an unlisted function over the cap and a listed one past its ceiling (planted)', () => {
    const lint = (source: string, functions: SizeCapExceptions['functions']): string[] =>
      new Linter({ configType: 'flat' })
        .verify(
          source,
          [
            {
              files: ['**/*.ts'],
              languageOptions: { parser: tsParser },
              plugins: { quality: qualityRules },
              rules: {
                'quality/function-size': ['error', { max: FUNCTION_LINE_LIMIT, exceptions: functions }],
              },
            },
          ],
          { filename: resolve(process.cwd(), 'lib/probe.ts') },
        )
        .map((message) => message.message);
    const listed = { 'lib/probe.ts': { probe: 90 } };

    const unlisted = lint(functionOfLines('probe', FUNCTION_LINE_LIMIT + 1), {});
    expect(unlisted).toHaveLength(1);
    expect(unlisted[0]).toContain(`"probe" has ${FUNCTION_LINE_LIMIT + 1} lines`);
    expect(lint(functionOfLines('probe', FUNCTION_LINE_LIMIT), {})).toEqual([]);

    const grown = lint(functionOfLines('probe', 91), listed);
    expect(grown).toHaveLength(1);
    expect(grown[0]).toContain('above its ceiling of 90');
    expect(lint(functionOfLines('probe', 90), listed)).toEqual([]);

    // A name that Object.prototype carries is not listed by inheritance.
    expect(lint(functionOfLines('toString', FUNCTION_LINE_LIMIT + 1), listed)).toHaveLength(1);
  });

  test('the effective configuration applies the caps and each listed module ceiling', async () => {
    const eslint = new ESLint();
    const product = await eslint.calculateConfigForFile('lib/size-cap-probe.ts');
    expect(product.rules['quality/function-size']).toEqual([
      2,
      { max: FUNCTION_LINE_LIMIT, exceptions: exceptions.functions },
    ]);
    expect(product.rules['max-lines-per-function']).toBeUndefined();
    expect(product.rules['max-lines']?.[1]?.max).toBe(MODULE_LINE_LIMIT);
    for (const [file, ceiling] of Object.entries(exceptions.modules)) {
      const config = await eslint.calculateConfigForFile(file);
      expect(config.rules['max-lines']?.[1]?.max, file).toBe(ceiling);
    }
  });
});
