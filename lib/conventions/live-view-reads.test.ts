import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for the background-read registry: a live view reads on mount, on a
// Realtime event and beside a save, so its `read` must not call a Server
// Action. One browser client's Server Actions run one after another, and a
// queued read delays the user's next save. The scan follows the `read`
// function and the same-file functions it calls; a call to an import from a
// `'use server'` module is a finding.

const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
const serverModuleCache = new Map<string, boolean>();

function resolveModule(importer: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(repositoryRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(repositoryRoot, dirname(importer), specifier)
      : null;
  if (base === null) return null;
  return MODULE_EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => existsSync(path)) ?? null;
}

function isServerActionModule(path: string): boolean {
  const cached = serverModuleCache.get(path);
  if (cached !== undefined) return cached;
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, false);
  let isServer = false;
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use server') isServer = true;
  }
  serverModuleCache.set(path, isServer);
  return isServer;
}

/** Local names this file imports from a `'use server'` module. */
function serverActionImports(file: string, source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.isTypeOnly) continue;
    const path = resolveModule(file, statement.moduleSpecifier.text);
    if (path === null || !isServerActionModule(path)) continue;
    for (const element of bindings.elements) if (!element.isTypeOnly) names.add(element.name.text);
  }
  return names;
}

/** Same-file function bodies by name, so a `read` that delegates is followed. */
function localFunctions(source: ts.SourceFile): Map<string, ts.Node> {
  const functions = new Map<string, ts.Node>();
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    )
      functions.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return functions;
}

function liveViewReads(node: ts.Node, found: ts.Node[] = []): ts.Node[] {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'useLiveView' &&
    node.arguments[0] &&
    ts.isObjectLiteralExpression(node.arguments[0])
  ) {
    for (const property of node.arguments[0].properties) {
      if (property.name && ts.isIdentifier(property.name) && property.name.text === 'read')
        found.push(property);
    }
  }
  ts.forEachChild(node, (child) => void liveViewReads(child, found));
  return found;
}

function serverActionCallsInLiveViewReads(file: string): string[] {
  const source = parseProductSource(file);
  const serverNames = serverActionImports(file, source);
  if (serverNames.size === 0) return [];
  const functions = localFunctions(source);
  const findings: string[] = [];
  const visited = new Set<ts.Node>();
  function follow(node: ts.Node): void {
    if (visited.has(node)) return;
    visited.add(node);
    const parent = node.parent;
    const isMemberName =
      (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node;
    if (ts.isIdentifier(node) && !isMemberName) {
      if (serverNames.has(node.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        findings.push(`${file}:${line} ${node.text}`);
      }
      const local = functions.get(node.text);
      if (local) follow(local);
    }
    ts.forEachChild(node, follow);
  }
  for (const read of liveViewReads(source)) {
    // `read: loadRows` and the shorthand `read` reach the named function.
    if (ts.isShorthandPropertyAssignment(read)) follow(read.name);
    else follow(read);
  }
  return findings;
}

/**
 * Only a file that names `useLiveView` can declare a live view. Git finds those
 * files in the working tree, untracked ones included, so the scan parses a
 * handful of files instead of every component.
 */
function filesNamingLiveViews(): Set<string> {
  const search = Bun.spawnSync(
    ['git', 'grep', '--untracked', '-l', 'useLiveView', '--', 'components', 'hooks'],
    { cwd: repositoryRoot },
  );
  // Exit code 1 means no match; anything else is a failed search, never an empty result.
  if (search.exitCode !== 0 && search.exitCode !== 1)
    throw new Error(`git grep failed: ${search.stderr.toString()}`);
  return new Set(search.stdout.toString().split(/\r?\n/).filter(Boolean));
}

test('no live view reads through a Server Action', () => {
  const candidates = filesNamingLiveViews();
  const findings = listProductSources(['components', 'hooks'])
    .filter((file) => candidates.has(file))
    .flatMap(serverActionCallsInLiveViewReads);
  expect(
    findings,
    'A live view read queues behind the user’s saves when it calls a Server Action. Register the reader in lib/data/background-reads.ts and call readInBackground with the read signal.',
  ).toEqual([]);
});
