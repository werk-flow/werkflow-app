import ts from 'typescript';

import { normalizedCode } from './evidence/source-content';

/**
 * The code of a spec file that a measured scenario runs: every `test(...)`
 * call whose source names the scenario id, the hooks and `test.use` calls of
 * the file, and the module-level declarations those reach, in source order.
 * Imports, unmeasured tests, comments and formatting stay out, so an edit to
 * another test of the file keeps the scenario's measurement digest.
 */

const HOOK_NAMES = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach', 'use']);

function isTestCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test';
}

function isHookCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'test' &&
    HOOK_NAMES.has(node.expression.name.text)
  );
}

function namesScenario(node: ts.Node, scenarioId: string): boolean {
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === scenarioId)
    return true;
  return ts.forEachChild(node, (child) => namesScenario(child, scenarioId) || undefined) ?? false;
}

function collect(node: ts.Node, match: (node: ts.Node) => boolean, found: ts.Node[]): void {
  if (match(node)) {
    found.push(node);
    return;
  }
  ts.forEachChild(node, (child) => collect(child, match, found));
}

function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name));
  if (
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement)) &&
    statement.name
  )
    return [statement.name.text];
  return [];
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
  );
}

function referencedIdentifiers(node: ts.Node, names: Set<string>): void {
  if (ts.isIdentifier(node)) names.add(node.text);
  ts.forEachChild(node, (child) => referencedIdentifiers(child, names));
}

export function measuredTestSource(file: string, source: string, scenarioId: string): string {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const tests: ts.Node[] = [];
  collect(sourceFile, (node) => isTestCall(node) && namesScenario(node, scenarioId), tests);
  if (!tests.length) throw new Error(`${file} has no test that records the measured scenario ${scenarioId}.`);
  const hooks: ts.Node[] = [];
  collect(sourceFile, isHookCall, hooks);

  const declarations = new Map<string, ts.Statement>();
  for (const statement of sourceFile.statements)
    for (const name of declaredNames(statement)) declarations.set(name, statement);

  const included = new Set<ts.Node>([...tests, ...hooks]);
  const pending = [...included];
  for (let node = pending.pop(); node; node = pending.pop()) {
    const names = new Set<string>();
    referencedIdentifiers(node, names);
    for (const name of names) {
      const declaration = declarations.get(name);
      if (!declaration || included.has(declaration)) continue;
      included.add(declaration);
      pending.push(declaration);
    }
  }

  return [...included]
    .sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile))
    .map((node) => normalizedCode(file, source.slice(node.getStart(sourceFile), node.end)))
    .join('\n\0\n');
}
