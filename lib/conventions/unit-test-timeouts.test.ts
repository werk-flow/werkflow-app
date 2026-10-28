// Rule test: a unit test never sets its own timeout (the preload and the runner set one hang guard for every file), and an assertion on a child exit code carries its output.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from './product-sources';

// scripts/unit-test-timeout.ts owns the one bound; scripts/unit-test-preload.ts
// and scripts/run-unit-tests.ts apply it. A test that needs more time than the
// guard is made cheaper (a smaller fixture, a shared parse, a cached program),
// never longer: a per-test timeout hides a slow test and lets the suite grow
// until the guard no longer means anything.

const TEST_CALLEES = new Set(['test', 'it', 'describe']);
const TIMEOUT_SETTERS = new Set(['setDefaultTimeout', 'jest.setTimeout']);

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression))
    return `${calleeName(expression.expression)}.${expression.name.text}`;
  if (ts.isCallExpression(expression)) return calleeName(expression.expression);
  return '';
}

function hasTimeoutProperty(argument: ts.Expression): boolean {
  return (
    ts.isObjectLiteralExpression(argument) &&
    argument.properties.some((property) => property.name?.getText() === 'timeout')
  );
}

/** One finding per per-test timeout: a third argument, a `{ timeout }` option or a default-timeout setter. */
function perTestTimeouts(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: string[] = [];
  function report(node: ts.Node, what: string): void {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    findings.push(`${file}:${line}: ${what}`);
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) inspectCall(node);
    ts.forEachChild(node, visit);
  }
  function inspectCall(node: ts.CallExpression): void {
    const name = calleeName(node.expression);
    if (TIMEOUT_SETTERS.has(name)) {
      report(node, `${name}(...) changes the hang guard`);
      return;
    }
    // `test.each(table)` only takes the table; the curried call takes the test.
    const curried = ts.isCallExpression(node.expression);
    if (!TEST_CALLEES.has(name.split('.')[0] ?? '') || (!curried && name.endsWith('.each'))) return;
    const shown = curried ? `${name}(...)(...)` : `${name}(...)`;
    const extra = node.arguments[2];
    if (node.arguments.some(hasTimeoutProperty)) report(node, `${shown} passes a { timeout } option`);
    else if (extra !== undefined) report(extra, `${shown} passes its own timeout or options`);
  }
  visit(source);
  return findings;
}

function listUnitTestFiles(): string[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'lib'],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  return listed
    .split('\0')
    .filter((file) => /\.test\.(?:ts|tsx|mjs)$/.test(file))
    .sort();
}

let unitTestSourceCache: { file: string; text: string }[] | undefined;

/** Every unit test file with its text, read once for all the scans of this file. */
function unitTestSources(): { file: string; text: string }[] {
  unitTestSourceCache ??= listUnitTestFiles().map((file) => ({
    file,
    text: readFileSync(resolve(repositoryRoot, file), 'utf8'),
  }));
  return unitTestSourceCache;
}

describe('unit tests share one hang guard', () => {
  test('no unit test passes its own timeout', () => {
    const findings = unitTestSources().flatMap(({ file, text }) => perTestTimeouts(file, text));
    expect(findings).toEqual([]);
  });

  test('probe: every per-test timeout form is found, plain tests and timer callbacks are not', () => {
    const probe = [
      "test('a', () => {}, 120_000);",
      "it('b', async () => {}, LIMIT);",
      "describe('c', () => {}, 5_000);",
      "test.skip('d', () => {}, { timeout: 1 });",
      "test('e', { timeout: 10 }, () => {});",
      "test.each([1])('f %d', () => {}, 30_000);",
      'setDefaultTimeout(90_000);',
      'jest.setTimeout(90_000);',
      "test('ok', () => { setTimeout(() => {}, 10); });",
      "describe('ok', () => { test('ok', () => {}); });",
      "test.each([1, 2])('ok %d', (value) => {});",
      'await expect(row).toBeVisible({ timeout: 15_000 });',
    ].join('\n');
    expect(perTestTimeouts('probe.test.ts', probe)).toEqual([
      'probe.test.ts:1: test(...) passes its own timeout or options',
      'probe.test.ts:2: it(...) passes its own timeout or options',
      'probe.test.ts:3: describe(...) passes its own timeout or options',
      'probe.test.ts:4: test.skip(...) passes a { timeout } option',
      'probe.test.ts:5: test(...) passes a { timeout } option',
      'probe.test.ts:6: test.each(...)(...) passes its own timeout or options',
      'probe.test.ts:7: setDefaultTimeout(...) changes the hang guard',
      'probe.test.ts:8: jest.setTimeout(...) changes the hang guard',
    ]);
  });
});

// A failed child process says why only through its output: an exit-code
// assertion without it left a pre-push hook failure undiagnosable.
const EXIT_NAMES = new Set(['exitCode', 'exited']);

/** The expression under `await`, parentheses, `!` and `as`: `expect(await child.exited)`. */
function unwrapped(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAwaitExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current)
  )
    current = current.expression;
  return current;
}

/** Every `expect(<exit code>)` without a message: the asserted value is an exit code by its name. */
function exitAssertionsWithoutOutput(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: string[] = [];
  ts.forEachChild(source, function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'expect') {
      const [asserted, message] = node.arguments;
      const value = asserted && unwrapped(asserted);
      const name = value && (ts.isPropertyAccessExpression(value) ? value.name.text : value.getText(source));
      if (name !== undefined && EXIT_NAMES.has(name) && message === undefined) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        findings.push(`${file}:${line}: expect(${value?.getText(source)}) carries no output`);
      }
    }
    ts.forEachChild(node, visit);
  });
  return findings;
}

describe('a child process names its failure', () => {
  test("every assertion on a child's exit code carries the child's output", () => {
    const findings = unitTestSources().flatMap(({ file, text }) => exitAssertionsWithoutOutput(file, text));
    expect(findings).toEqual([]);
  });

  test('probe: a bare exit code fails, one with its output and other values pass', () => {
    const probe = [
      'expect(result.exitCode).toBe(0);',
      "expect(error?.code).toBe('42501');",
      'expect(result.exitCode, result.output).toBe(0);',
      'expect(response.status).toBe(200);',
      'expect(await child.exited).toBe(0);',
      'expect((result)!.exitCode).toBe(0);',
    ].join('\n');
    expect(exitAssertionsWithoutOutput('probe.test.ts', probe)).toEqual([
      'probe.test.ts:1: expect(result.exitCode) carries no output',
      'probe.test.ts:5: expect(child.exited) carries no output',
      'probe.test.ts:6: expect((result)!.exitCode) carries no output',
    ]);
  });
});
