// Rule test: an assertion on a child exit code in a unit test carries the child's output. Per-test timeouts are lint (test-hygiene/no-per-test-timeout).
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from './product-sources';

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
  // A `.ts` file parsed as TSX reads `<T>` as JSX and loses the calls after it.
  const kind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : file.endsWith('.mjs')
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
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
    const findings = listUnitTestFiles().flatMap((file) =>
      exitAssertionsWithoutOutput(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
    );
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
