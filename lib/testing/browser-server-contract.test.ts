import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { PLAYWRIGHT_LANES } from './run-policy';

const repositoryRoot = resolve(import.meta.dir, '../..');

function sourceAt(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(resolve(repositoryRoot, path), 'utf8'), ts.ScriptTarget.Latest, true);
}

test('business browser configurations cannot start a fallback server', () => {
  for (const path of ['playwright.config.ts', 'playwright.audit.config.ts', 'playwright.canary.config.ts']) {
    const properties: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isPropertyAssignment(node)) properties.push(node.name.getText().replaceAll(/['"]/g, ''));
      ts.forEachChild(node, visit);
    }
    visit(sourceAt(path));
    expect(properties, path).not.toContain('webServer');
  }
});

test('preflight requires the recorded app server for every lane before backend probes', () => {
  const source = sourceAt('scripts/playwright-preflight.ts');
  const preflight = source.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'runPlaywrightPreflight');
  if (!preflight?.body) throw new Error('The runner preflight entry is missing.');
  const directCalls = preflight.body.statements.map((statement) => {
    if (!ts.isExpressionStatement(statement)) return null;
    const expression = ts.isAwaitExpression(statement.expression) ? statement.expression.expression : statement.expression;
    return ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : null;
  });
  const recordedServer = directCalls.indexOf('assertRecordedAppServer');
  expect(recordedServer).toBeGreaterThanOrEqual(0);
  expect(recordedServer).toBeLessThan(directCalls.indexOf('runBackendPreflight'));
  expect(source.text).not.toContain('assertReusableServer');
});

test('a group runner skips the preflight only with a prepared plan from the verification run', () => {
  // The verification run preflights once and hands each group a plan; a direct lane still preflights itself.
  const runner = sourceAt('scripts/run-playwright.ts').text;
  expect(runner).toContain("if (!preparedRun) await runPlaywrightPreflight({ lane, target, repositoryRoot });");
  expect(runner).toContain("const preparedPlan = lane === 'group' ? readPreparedPlan() : null;");
  const verify = sourceAt('scripts/verify.ts').text;
  expect(verify).toContain('await runPlaywrightPreflight({ lane: "group", target: options.target, repositoryRoot: repository });');
  expect(verify).toContain('process.env[PREPARED_PLAN_ENV] = preparedPath;');
});

test('provider-only bootstrap cannot be selected as a business browser lane', () => {
  expect(PLAYWRIGHT_LANES).not.toContain('backend');
  const bootstrap = sourceAt('scripts/test-server.ts').text;
  expect(bootstrap).toContain("'test:preflight', 'backend', target");
  expect(bootstrap).not.toContain("'test:preflight', 'iteration'");
});

test('standalone local cleanup keeps WSL alive and cancels the owned child before lease release', () => {
  const cleanup = sourceAt('scripts/manage-playwright-runs.ts').text;
  for (const command of ['cleanup', 'cleanup-all', 'cleanup-local-relocated']) expect(cleanup).toContain(`'${command}'`);
  expect(cleanup).toContain('localMailpitUrl');
  expect(cleanup).toContain('withLocalStackLease(true, (signal) => runSessionCommand(');
  expect(cleanup).toContain('{ signal, env:');
  expect(cleanup).toContain('AbortSignal.timeout(180_000)');
  expect(cleanup).toContain('withWorkspaceTestLock');
});
