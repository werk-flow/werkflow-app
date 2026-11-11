// Rule test: offline code that runs only sometimes loads lazily. The field cold start's script
// bytes have almost no margin, and a static import puts a module into a startup chunk of every
// page that imports it. Product code reaches an offline module only through `import()`; offline
// modules may import each other, since they load together. The registration and the shell refill
// every cold start needs stay in the app shell: a chunk loaded after the load event still costs
// the lab's cold start a request and its bytes.
//
// A lazy load can fail (a lost connection, a new deployment), so each `import()` of an offline
// module is awaited (or returned) inside a try block with a catch clause in its own
// function, or sits in a function the module calls only that way: a sign-out or switch whose
// load fails shows its error instead of stopping silently.
//
// The one exception is the cache clear (lib/offline/service-worker-caches.ts). Sign-out, an
// organization switch and account deletion call it, and in a tab open across a deployment a lazy
// chunk can be gone, so every retry of a lazy load fails and the person can never sign out on a
// shared phone. Every such flow imports it statically and never loads it lazily. It imports
// nothing but the logging every startup chunk already carries, so it costs the cold start only
// its own few lines, the same precedent as the manual entry bridge's import-free clear
// (sign-out-clears-tab-state.test.ts, werk-flow/werkflow-app#232).
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { resolveSpecifier } from './action-prechecks-scan';
import { moduleSpecifierOf, repositorySources, resolveModuleFile, type SourceHost } from './module-imports';
import { listProductSources, parseProductSource } from './product-sources';

/** The cache clear every sign-out, switch and deletion imports statically. */
const CACHE_CLEAR_MODULE = 'lib/offline/service-worker-caches.ts';
/** The only module the cache clear may import: every startup chunk already carries it. */
const CACHE_CLEAR_IMPORTS = ['@/lib/logging'];

/**
 * The time outbox, the sync runner, the unsent-work check and their views
 * (werk-flow/werkflow-planning#319). The clock dock and the menu sign-out sit in chunks every page
 * loads at start, so they reach these only through `import()`. The offline page is a bundle of its
 * own and imports its clock statically.
 */
const UNSENT_WORK_MODULES: readonly string[] = [
  'app/offline/page.tsx',
  'components/clock-offline.tsx',
  'components/clock-unsent-events.tsx',
  'components/clock-unsent-list.tsx',
  'components/shared/unsent-work-prompt.tsx',
  'lib/field-sync/device/clock-device.ts',
  'lib/field-sync/device/clock-outbox.ts',
  'lib/field-sync/device/registrations.ts',
  'lib/field-sync/device/sync-runner.ts',
  'lib/field-sync/device/time-outbox-send.ts',
  'lib/field-sync/device/time-outbox-store.ts',
  'lib/field-sync/device/time-outbox.ts',
  'lib/field-sync/device/unsent-work.ts',
];

/** The offline modules that load lazily: the unsent work of a phone, and the iOS install hint. */
function isOfflineModule(file: string): boolean {
  return (
    (file.startsWith('lib/offline/') && file !== CACHE_CLEAR_MODULE) ||
    file === 'components/shared/ios-install-hint.tsx' ||
    UNSENT_WORK_MODULES.includes(file)
  );
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

/** True when the promise is awaited, or returned to a caller that the same rule then checks. */
function awaitedOrReturned(call: ts.CallExpression): boolean {
  return ts.isAwaitExpression(call.parent) || ts.isReturnStatement(call.parent);
}

/** True when the node sits in the try block of a try with a catch clause, inside its own function. */
function insideCatchingTry(node: ts.Node): boolean {
  for (let current: ts.Node = node; current.parent && !ts.isFunctionLike(current); current = current.parent) {
    const parent = current.parent;
    if (ts.isTryStatement(parent) && parent.tryBlock === current && parent.catchClause) return true;
  }
  return false;
}

/** The function declaration whose body holds the node directly, not through a nested function. */
function enclosingFunctionDeclaration(node: ts.Node): ts.FunctionDeclaration | null {
  for (let current: ts.Node = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current)) return current;
    if (ts.isFunctionLike(current)) return null;
  }
  return null;
}

/** True when the module calls function `name`, and every call is awaited inside a catching try. */
function calledOnlyCaught(source: ts.SourceFile, name: string): boolean {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name)
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return (
    calls.length > 0 && calls.every((call) => ts.isAwaitExpression(call.parent) && insideCatchingTry(call))
  );
}

function caught(load: ts.CallExpression, source: ts.SourceFile): boolean {
  if (!awaitedOrReturned(load)) return false;
  if (ts.isAwaitExpression(load.parent) && insideCatchingTry(load)) return true;
  const declaration = enclosingFunctionDeclaration(load);
  return declaration?.name !== undefined && calledOnlyCaught(source, declaration.name.text);
}

function isCaughtLoadTarget(target: string): boolean {
  return (
    (target.startsWith('lib/offline/') && target !== CACHE_CLEAR_MODULE) ||
    UNSENT_WORK_MODULES.includes(target)
  );
}

/** The `import()` calls of lib/offline/ and unsent-work modules that no try block catches, as file and line. */
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
      // The iOS hint's load failing shows nothing by design; every other offline module's failure must reach the person.
      if (target !== null && isCaughtLoadTarget(target) && !caught(node, source))
        found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The `import()` calls of the cache clear, as file and line: a flow that waits for a chunk can fail for good. */
function lazyCacheClearLoads(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null) return [];
  const source = parseProductSource(file, text);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (
        specifier &&
        ts.isStringLiteralLike(specifier) &&
        resolveTarget(file, specifier.text, host) === CACHE_CLEAR_MODULE
      )
        found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** What the cache clear imports beyond the logging, static or lazy: a sign-out would wait for it. */
function foreignCacheClearImports(host: SourceHost): string[] {
  const text = host(CACHE_CLEAR_MODULE);
  if (text === null) return [];
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier =
      ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? (node.arguments[0]?.getText() ?? 'import()')
        : ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? moduleSpecifierOf(node)
          : null;
    if (specifier !== null && !CACHE_CLEAR_IMPORTS.includes(specifier)) found.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(parseProductSource(CACHE_CLEAR_MODULE, text));
  return found;
}

describe('offline code loads lazily', () => {
  test('no product module outside the offline modules imports one statically', () => {
    expect(listProductSources().flatMap((file) => staticOfflineImports(file, repositorySources))).toEqual([]);
  });

  test('every lazy load of an offline module is caught, so its failure reaches the person', () => {
    expect(listProductSources().flatMap((file) => uncaughtOfflineLoads(file, repositorySources))).toEqual([]);
  });

  test('no flow loads the cache clear lazily, so a sign-out, switch or deletion never waits for a chunk', () => {
    expect(listProductSources().flatMap((file) => lazyCacheClearLoads(file, repositorySources))).toEqual([]);
  });

  test('the cache clear imports nothing but the logging every startup chunk carries, and loads nothing lazily', () => {
    expect(foreignCacheClearImports(repositorySources)).toEqual([]);
  });

  const LAZY = 'lib/offline/offline-data.ts';
  const files: Record<string, string> = {
    [CACHE_CLEAR_MODULE]: 'export async function clearServiceWorkerCaches() {}',
    [LAZY]: 'export async function readOfflineData() {}',
    'components/probe-static.ts': "import { readOfflineData } from '@/lib/offline/offline-data';",
    'components/probe-extension.ts': "import { readOfflineData } from '@/lib/offline/offline-data.ts';",
    'components/probe-reexport.ts': "export { readOfflineData } from '../lib/offline/offline-data';",
    'components/probe-type.ts': "import type { X } from '@/lib/offline/offline-data';",
    'lib/offline/outbox.ts': "import { readOfflineData } from '@/lib/offline/offline-data';",
    'components/probe-cache-clear.ts':
      "import { clearServiceWorkerCaches } from '@/lib/offline/service-worker-caches';",
    'components/probe-uncaught.ts':
      "export async function out() { const m = await import('@/lib/offline/offline-data'); }",
    'components/probe-caught.ts':
      "export async function out() { try { await import('@/lib/offline/offline-data'); } catch {} }",
    'components/probe-caller.ts': [
      "async function load() { return import('@/lib/offline/offline-data'); }",
      'export async function out() { try { await load(); } catch {} }',
    ].join('\n'),
    'components/probe-finally.ts':
      "export async function out() { try { await import('@/lib/offline/offline-data'); } finally {} }",
    'components/probe-unawaited.ts':
      "export async function out() { try { void import('@/lib/offline/offline-data'); } catch {} }",
    'components/probe-nested.ts':
      "export function out() { try { setTimeout(async () => { await import('@/lib/offline/offline-data'); }); } catch {} }",
    'components/probe-unawaited-caller.ts': [
      "async function load() { return import('@/lib/offline/offline-data'); }",
      'export async function out() { try { void load(); } catch {} }',
    ].join('\n'),
    'components/probe-uncaught-caller.ts': [
      "async function load() { return import('@/lib/offline/offline-data'); }",
      'export async function out() { try { await load(); } catch {} }',
      'export async function other() { await load(); }',
    ].join('\n'),
    'components/probe-lazy-cache-clear.ts':
      "export async function out() { try { await import('@/lib/offline/service-worker-caches.ts'); } catch {} }",
  };
  const host: SourceHost = (file) => files[file] ?? null;

  test('probes: static imports and re-exports are reported, with or without an extension; others are not', () => {
    for (const file of [
      'components/probe-static.ts',
      'components/probe-extension.ts',
      'components/probe-reexport.ts',
    ])
      expect(staticOfflineImports(file, host), file).toEqual([`${file} -> ${LAZY}`]);
    for (const file of [
      'components/probe-uncaught.ts',
      'components/probe-type.ts',
      'lib/offline/outbox.ts',
      'components/probe-cache-clear.ts',
    ])
      expect(staticOfflineImports(file, host), file).toEqual([]);
  });

  test('probes: a lazy load is reported unless awaited in a catching try, or every caller of its function catches', () => {
    for (const file of [
      'components/probe-uncaught.ts',
      'components/probe-uncaught-caller.ts',
      'components/probe-finally.ts',
      'components/probe-unawaited.ts',
      'components/probe-nested.ts',
      'components/probe-unawaited-caller.ts',
    ])
      expect(uncaughtOfflineLoads(file, host), file).toEqual([`${file}:1`]);
    for (const file of ['components/probe-caught.ts', 'components/probe-caller.ts'])
      expect(uncaughtOfflineLoads(file, host), file).toEqual([]);
  });

  test('probes: the cache clear may import the logging only, and never load a module lazily', () => {
    const probe =
      (text: string): SourceHost =>
      (file) =>
        file === CACHE_CLEAR_MODULE ? text : null;
    expect(foreignCacheClearImports(probe("import { logError } from '@/lib/logging';"))).toEqual([]);
    expect(
      foreignCacheClearImports(
        probe(
          "import { z } from 'zod'; export async function f() { try { await import('@/lib/offline/offline-data'); } catch {} }",
        ),
      ),
    ).toEqual(['zod', "'@/lib/offline/offline-data'"]);
  });

  test('probes: a lazy load of the cache clear is reported even when caught; a static import is not', () => {
    expect(lazyCacheClearLoads('components/probe-lazy-cache-clear.ts', host)).toEqual([
      'components/probe-lazy-cache-clear.ts:1',
    ]);
    for (const file of ['components/probe-cache-clear.ts', 'components/probe-caught.ts'])
      expect(lazyCacheClearLoads(file, host), file).toEqual([]);
  });
});
