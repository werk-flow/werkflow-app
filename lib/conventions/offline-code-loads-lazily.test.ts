// Rule test: offline code that runs only sometimes loads lazily. The field cold start's script
// bytes have almost no margin, and a static import puts a module into a startup chunk of every
// page that imports it. Product code reaches an offline module only through `import()`; offline
// modules may import each other, since they load together. The registration and the shell refill
// every cold start needs stay in the app shell: a chunk loaded after the load event still costs
// the lab's cold start a request and its bytes.
//
// A lazy load can fail (a lost connection, a new deployment), so each `import()` of a module
// under lib/offline/ sits in a try block, or in a function the module calls only inside try blocks: a
// sign-out or switch whose load fails shows its error instead of stopping silently.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { resolveSpecifier } from './action-prechecks-scan';
import { moduleSpecifierOf, repositorySources, resolveModuleFile, type SourceHost } from './module-imports';
import { listProductSources, parseProductSource } from './product-sources';

/** The offline modules: the cache clear, later the offline data, and the iOS install hint. */
function isOfflineModule(file: string): boolean {
  return file.startsWith('lib/offline/') || file === 'components/shared/ios-install-hint.tsx';
}

/** The product module a specifier names, with or without its file extension. */
function resolveTarget(importer: string, specifier: string, host: SourceHost): string | null {
  const exact = resolveSpecifier(importer, specifier);
  if (exact !== null && /\.tsx?$/.test(exact) && host(exact) !== null) return exact;
  return resolveModuleFile(importer, specifier, host);
}

/** The offline modules a product module imports or re-exports statically; type-only imports leave no code. */
function staticOfflineImports(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null || isOfflineModule(file)) return [];
  return parseProductSource(file, text)
    .statements.filter(
      (statement) =>
        !(ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) &&
        !(ts.isExportDeclaration(statement) && statement.isTypeOnly),
    )
    .flatMap((statement) => {
      const specifier = moduleSpecifierOf(statement);
      const target = specifier === null ? null : resolveTarget(file, specifier, host);
      return target !== null && isOfflineModule(target) ? [`${file} -> ${target}`] : [];
    });
}

function insideTryBlock(node: ts.Node): boolean {
  for (let current: ts.Node = node; current.parent; current = current.parent) {
    if (ts.isTryStatement(current.parent) && current.parent.tryBlock === current) return true;
  }
  return false;
}

/** True when every call of the module-level function `name` in the module sits in a try block. */
function calledOnlyInsideTry(source: ts.SourceFile, name: string): boolean {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name)
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return calls.length > 0 && calls.every(insideTryBlock);
}

function caught(load: ts.CallExpression, source: ts.SourceFile): boolean {
  if (insideTryBlock(load)) return true;
  for (let current: ts.Node = load; current.parent; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name)
      return calledOnlyInsideTry(source, current.name.text);
  }
  return false;
}

/** The `import()` calls of lib/offline/ modules that no try block catches, as file and line. */
function uncaughtOfflineLoads(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null || isOfflineModule(file)) return [];
  const source = parseProductSource(file, text);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      const target =
        specifier && ts.isStringLiteralLike(specifier) ? resolveTarget(file, specifier.text, host) : null;
      if (target?.startsWith('lib/offline/') && !caught(node, source))
        found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('offline code loads lazily', () => {
  test('no product module outside the offline modules imports one statically', () => {
    expect(listProductSources().flatMap((file) => staticOfflineImports(file, repositorySources))).toEqual([]);
  });

  test('every lazy load of an offline module is caught, so its failure reaches the person', () => {
    expect(listProductSources().flatMap((file) => uncaughtOfflineLoads(file, repositorySources))).toEqual([]);
  });

  const files: Record<string, string> = {
    'lib/offline/service-worker-caches.ts': 'export async function clearServiceWorkerCaches() {}',
    'components/probe-static.ts':
      "import { clearServiceWorkerCaches } from '@/lib/offline/service-worker-caches';",
    'components/probe-extension.ts':
      "import { clearServiceWorkerCaches } from '@/lib/offline/service-worker-caches.ts';",
    'components/probe-reexport.ts':
      "export { clearServiceWorkerCaches } from '../lib/offline/service-worker-caches';",
    'components/probe-type.ts': "import type { X } from '@/lib/offline/service-worker-caches';",
    'lib/offline/outbox.ts':
      "import { clearServiceWorkerCaches } from '@/lib/offline/service-worker-caches';",
    'components/probe-uncaught.ts':
      "export async function out() { const m = await import('@/lib/offline/service-worker-caches'); }",
    'components/probe-caught.ts':
      "export async function out() { try { await import('@/lib/offline/service-worker-caches'); } catch {} }",
    'components/probe-caller.ts': [
      "async function load() { return import('@/lib/offline/service-worker-caches'); }",
      'export async function out() { try { await load(); } catch {} }',
    ].join('\n'),
    'components/probe-uncaught-caller.ts': [
      "async function load() { return import('@/lib/offline/service-worker-caches'); }",
      'export async function out() { try { await load(); } catch {} }',
      'export async function other() { await load(); }',
    ].join('\n'),
  };
  const host: SourceHost = (file) => files[file] ?? null;

  test('probes: static imports and re-exports are reported, with or without an extension; others are not', () => {
    for (const file of [
      'components/probe-static.ts',
      'components/probe-extension.ts',
      'components/probe-reexport.ts',
    ])
      expect(staticOfflineImports(file, host), file).toEqual([
        `${file} -> lib/offline/service-worker-caches.ts`,
      ]);
    for (const file of ['components/probe-uncaught.ts', 'components/probe-type.ts', 'lib/offline/outbox.ts'])
      expect(staticOfflineImports(file, host), file).toEqual([]);
  });

  test('probes: a lazy load outside a try block is reported, unless every caller of its function catches', () => {
    expect(uncaughtOfflineLoads('components/probe-uncaught.ts', host)).toEqual([
      'components/probe-uncaught.ts:1',
    ]);
    expect(uncaughtOfflineLoads('components/probe-uncaught-caller.ts', host)).toEqual([
      'components/probe-uncaught-caller.ts:1',
    ]);
    for (const file of ['components/probe-caught.ts', 'components/probe-caller.ts'])
      expect(uncaughtOfflineLoads(file, host), file).toEqual([]);
  });
});
