import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Tier 2 guard for SI-025. Every exported function of a 'use server' module is
// a public POST endpoint. Each one must establish the caller's identity through
// one of the approved helpers, or be listed below with the reason it may not.
// This proves the presence of a check, not its correctness; the boundary
// tests own that.

const repositoryRoot = resolve(import.meta.dir, '../..');

const identityHelpers = new Set([
  'getAuthenticatedUser',
  'getCachedUser',
  'authenticateAndAuthorize',
  'requireAuth',
  'resolveActionContext',
  'getAuthContext',
  'getAuthorizedDocumentContext',
  'getAuthorizedProjectContext',
  'getAuthorizedJobContext',
  'getAuthorizedWorkContext',
  'requireManagerAndClient',
  'verifyMembershipFromCache',
]);

function isIdentityHelper(name: string): boolean {
  return (
    identityHelpers.has(name) ||
    /^require[A-Z]/.test(name) ||
    /^getAuthorized[A-Z]\w*Context$/.test(name) ||
    /^authorize[A-Z]/.test(name)
  );
}

// Exports that intentionally run without a caller identity. Keep each reason
// true; removing an entry requires the function to gain a check.
const allowlist: Record<string, string> = {
  'lib/org/actions.ts#getActiveOrgCookie': 'reads the caller\'s own cookie value; no data access',
  'lib/dispatch/actions.ts#previewDispatchReadiness': 'delegates to authenticateAndAuthorize inside the first statement chain',
};

function listServerActionModules(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        const source = ts.createSourceFile(path, readFileSync(resolve(repositoryRoot, path), 'utf8'), ts.ScriptTarget.Latest, true);
        const first = source.statements[0];
        const isServerModule =
          first !== undefined &&
          ts.isExpressionStatement(first) &&
          ts.isStringLiteral(first.expression) &&
          first.expression.text === 'use server';
        if (isServerModule) found.push(path);
      }
    }
  }
  for (const root of ['lib', 'app', 'components']) visit(root);
  return found.sort();
}

function calledIdentifiers(node: ts.Node, collected: Set<string>): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) collected.add(callee.text);
    else if (ts.isPropertyAccessExpression(callee)) collected.add(callee.name.text);
  }
  ts.forEachChild(node, (child) => calledIdentifiers(child, collected));
}

type ExportedAction = { name: string; body: ts.Node | undefined };

function hasExportModifier(statement: ts.Statement): boolean {
  return !!ts.canHaveModifiers(statement) &&
    !!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

// Every export shape that can become a Server Action: function declarations,
// exported arrow or function expressions, and default exports. Re-exports are
// rejected outright because their targets cannot be checked here.
function exportedActions(file: string, source: ts.SourceFile): ExportedAction[] {
  const actions: ExportedAction[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      throw new Error(`${file} re-exports through 'use server'; move the export next to its authorization check`);
    }
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      actions.push({ name: statement.name?.text ?? 'default', body: statement.body });
      continue;
    }
    if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
          actions.push({ name: declaration.name.getText(source), body: initializer.body });
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      actions.push({ name: 'default', body: statement.expression });
    }
  }
  return actions;
}

test('every exported Server Action establishes the caller identity or is allowlisted with a reason', () => {
  const unguarded: string[] = [];
  const staleAllowlist = new Set(Object.keys(allowlist));
  for (const file of listServerActionModules()) {
    const source = ts.createSourceFile(file, readFileSync(resolve(repositoryRoot, file), 'utf8'), ts.ScriptTarget.Latest, true);
    // Module-local helpers count when they reach an identity helper, directly
    // or through other local helpers (fixpoint over the call graph).
    const callsByLocalFunction = new Map<string, Set<string>>();
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
        const calls = new Set<string>();
        calledIdentifiers(statement.body, calls);
        callsByLocalFunction.set(statement.name.text, calls);
      }
    }
    const localHelpers = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, calls] of callsByLocalFunction) {
        if (localHelpers.has(name)) continue;
        if ([...calls].some((call) => isIdentityHelper(call) || localHelpers.has(call))) {
          localHelpers.add(name);
          changed = true;
        }
      }
    }
    for (const action of exportedActions(file, source)) {
      const key = `${file}#${action.name}`;
      const calls = new Set<string>();
      if (action.body) calledIdentifiers(action.body, calls);
      const guarded = [...calls].some((call) => isIdentityHelper(call) || localHelpers.has(call));
      if (allowlist[key]) {
        staleAllowlist.delete(key);
        continue;
      }
      if (!guarded) unguarded.push(key);
    }
  }
  expect(unguarded).toEqual([]);
  expect([...staleAllowlist], 'allowlist entries that no longer exist').toEqual([]);
});
