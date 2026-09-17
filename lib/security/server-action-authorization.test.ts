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
  'verifyCurrentMembership',
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
  'lib/dispatch/actions.ts#previewDispatchReadiness': 'delegates to authenticateAndAuthorize inside the first statement chain',
};

function listApplicationSources(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
        found.push(path);
      }
    }
  }
  for (const root of ['lib', 'app', 'components', 'hooks']) visit(root);
  return found.sort();
}

function calledIdentifiers(node: ts.Node, collected: Set<string>): void {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    if (ts.isIdentifier(callee)) collected.add(callee.text);
    else if (ts.isPropertyAccessExpression(callee)) collected.add(callee.name.text);
  }
  ts.forEachChild(node, (child) => {
    // Defining a nested callback does not execute its identity check.
    if (!ts.isFunctionLike(child)) calledIdentifiers(child, collected);
  });
}

type ExportedAction = { name: string; body: ts.Node | undefined };

function hasServerDirective(statements: readonly ts.Statement[]): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function hasExportModifier(statement: ts.Statement): boolean {
  return !!ts.canHaveModifiers(statement) &&
    !!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

// Every export shape that can become a Server Action: function declarations,
// exported arrow or function expressions, and default exports. Re-exports are
// rejected outright because their targets cannot be checked here.
function exportedActions(file: string, source: ts.SourceFile): ExportedAction[] {
  const actions: ExportedAction[] = [];
  if (hasServerDirective(source.statements)) for (const statement of source.statements) {
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
        } else {
          throw new Error(`${file} exports an unresolved action alias ${declaration.name.getText(source)}; export the function beside its identity check`);
        }
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      if (!ts.isArrowFunction(statement.expression) && !ts.isFunctionExpression(statement.expression)) {
        throw new Error(`${file} exports an unresolved default action alias; export the function beside its identity check`);
      }
      actions.push({ name: 'default', body: statement.expression.body });
    }
  }
  function visitInline(node: ts.Node): void {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) &&
        node.body && ts.isBlock(node.body) && hasServerDirective(node.body.statements) &&
        !actions.some((action) => action.body === node.body)) {
      actions.push({ name: `inline:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`, body: node.body });
    }
    ts.forEachChild(node, visitInline);
  }
  visitInline(source);
  return actions;
}

function unguardedActions(file: string, source: ts.SourceFile, actions = exportedActions(file, source)): string[] {
  const unguarded: string[] = [];
  if (!actions.length) return unguarded;

  // Module-local helpers count when they reach an identity helper, directly
  // or through other local helpers (fixpoint over the call graph).
  const callsByLocalFunction = new Map<string, Set<string>>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const calls = new Set<string>();
      calledIdentifiers(statement.body, calls);
      callsByLocalFunction.set(statement.name.text, calls);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || !initializer ||
            !(ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) continue;
        const calls = new Set<string>();
        calledIdentifiers(initializer.body, calls);
        callsByLocalFunction.set(declaration.name.text, calls);
      }
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
  for (const action of actions) {
    const key = `${file}#${action.name}`;
    const calls = new Set<string>();
    if (action.body) calledIdentifiers(action.body, calls);
    const guarded = [...calls].some((call) => isIdentityHelper(call) || localHelpers.has(call));
    if (allowlist[key]) {
      continue;
    }
    if (!guarded) unguarded.push(key);
  }
  return unguarded;
}

test('module and inline Server Actions establish identity or have a reviewed exception', () => {
  const unguarded: string[] = [];
  const existing = new Set<string>();
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    // Most files contain no directive. Keep escaped spellings eligible for AST
    // inspection without parsing huge generated types on every unit run.
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const actions = exportedActions(file, source);
    for (const action of actions) existing.add(`${file}#${action.name}`);
    unguarded.push(...unguardedActions(file, source, actions));
  }
  expect(unguarded).toEqual([]);
  expect(Object.keys(allowlist).filter((key) => !existing.has(key)), 'stale action exceptions').toEqual([]);
});

function couldContainServerDirective(text: string): boolean {
  return text.includes('use server') || text.includes('\\');
}

function fixture(source: string): string[] {
  return unguardedActions('app/fixture.tsx', ts.createSourceFile('app/fixture.tsx', source, ts.ScriptTarget.Latest, true));
}

test('inline use-server functions inside an ordinary page cannot bypass the identity inventory', () => {
  expect(fixture(`export default function Page() { async function save() { 'use server'; return readPrivate(); } }`)).toHaveLength(1);
  expect(fixture(`export default function Page() { return <form action={async () => { 'use server'; return readPrivate(); }} />; }`)).toHaveLength(1);
  expect(fixture(`export default function Page() { async function save() { 'use server'; await getAuthenticatedUser(); return readPrivate(); } }`)).toEqual([]);
});

test('unresolved action aliases and re-exports fail instead of silently disappearing', () => {
  expect(() => fixture(`'use server'; const inner = async () => readPrivate(); export const save = inner;`)).toThrow('unresolved action alias');
  expect(() => fixture(`'use server'; const inner = async () => readPrivate(); export default inner;`)).toThrow('unresolved default action alias');
  expect(() => fixture(`'use server'; export { save } from './other';`)).toThrow('re-exports');
});

test('direct functions and directive prologues are inventoried while literal text is not a directive', () => {
  expect(fixture(`'use strict'; 'use server'; export async function save() { return readPrivate(); }`)).toHaveLength(1);
  expect(fixture(`'use server'; export const save = async () => readPrivate(); export default async function() { return readPrivate(); }`)).toHaveLength(2);
  expect(fixture(`const explanation = 'use server'; export const value = 1;`)).toEqual([]);
  expect(fixture(`'use server'; export async function save() { const unused = async () => getAuthenticatedUser(); return readPrivate(); }`)).toHaveLength(1);
  const escaped = String.raw`'use\x20server'; export async function save() { return readPrivate(); }`;
  expect(couldContainServerDirective(escaped)).toBe(true);
  expect(fixture(escaped)).toHaveLength(1);
});

test('called arrow and expression helpers establish identity, unused closures do not', () => {
  expect(fixture(`'use server'; const guard = async () => getAuthenticatedUser(); export async function save() { await guard(); return readPrivate(); }`)).toEqual([]);
  expect(fixture(`'use server'; const guard = async function() { await getAuthenticatedUser(); }; export async function save() { await guard(); return readPrivate(); }`)).toEqual([]);
  expect(fixture(`'use server'; const guard = async () => { const unused = () => getAuthenticatedUser(); }; export async function save() { await guard(); return readPrivate(); }`)).toHaveLength(1);
});

// Step 3 (2026-09-13) found 27 exported Server Actions with no caller in the
// application: each one was a reachable public POST endpoint that no page,
// component or hook used. An action must be imported by product code or not
// exist; test-only use does not keep a public endpoint alive.
function normalizeModulePath(fromFile: string, specifier: string): string | null {
  let target: string;
  if (specifier.startsWith('@/')) target = specifier.slice(2);
  else if (specifier.startsWith('.')) {
    const parts = fromFile.split('/');
    parts.pop();
    for (const segment of specifier.split('/')) {
      if (segment === '.') continue;
      if (segment === '..') parts.pop();
      else parts.push(segment);
    }
    target = parts.join('/');
  } else return null;
  return target.replace(/\.[cm]?[jt]sx?$/, '');
}

function importedNamesByModule(): Map<string, Set<string>> {
  const imported = new Map<string, Set<string>>();
  const record = (modulePath: string, name: string): void => {
    if (!imported.has(modulePath)) imported.set(modulePath, new Set());
    imported.get(modulePath)!.add(name);
  };
  // A text scan keeps this under the unit timeout: import and re-export statements in
  // this repository are plain `import ... from '...'` / `export { ... } from '...'` forms.
  const statement = /^(import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const match of text.matchAll(statement)) {
      const [, , typeOnly, clause, specifier] = match;
      if (typeOnly) continue;
      const modulePath = normalizeModulePath(file, specifier!);
      if (!modulePath) continue;
      const bindings = clause!.trim();
      if (bindings.startsWith('*')) { record(modulePath, '*'); continue; }
      const braces = /\{([^}]*)\}/.exec(bindings);
      const defaultImport = bindings.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
      if (defaultImport && !defaultImport.startsWith('type')) record(modulePath, 'default');
      for (const entry of braces?.[1]?.split(',') ?? []) {
        // split() always yields a first element; the fallback only satisfies the index type.
        const name = (entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0] ?? '').trim();
        if (name) record(modulePath, name);
      }
    }
  }
  return imported;
}

test('every exported Server Action is imported by product code', () => {
  const imported = importedNamesByModule();
  const dead: string[] = [];
  for (const file of listApplicationSources()) {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    if (!couldContainServerDirective(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (!hasServerDirective(source.statements)) continue;
    const modulePath = file.replace(/\.[cm]?[jt]sx?$/, '');
    const names = imported.get(modulePath) ?? new Set<string>();
    for (const action of exportedActions(file, source)) {
      if (action.name.startsWith('inline:')) continue;
      if (names.has('*') || names.has(action.name)) continue;
      dead.push(`${file}#${action.name}`);
    }
  }
  expect(dead, 'exported Server Actions with no product caller (delete them or wire them; see docs/plans/phase-1/hardening-2026-09/07-step-3-final-beta-acceptance.md)').toEqual([]);
});
