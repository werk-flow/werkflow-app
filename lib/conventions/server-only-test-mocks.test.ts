import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { repositorySources, resolveProductModule, type SourceHost } from './module-imports';
import { repositoryRoot } from './product-sources';

// Tier 2 (decision 0005) for test isolation. One process runs every unit
// test file, and a `mock.module` stays registered for the files after it
// (scripts/run-unit-tests.ts). A test that loads a module importing
// 'server-only' without mocking 'server-only' itself passes only behind an
// earlier file's mock, and fails when run alone, first, or in another part.
//
// Such a test calls `mock.module('server-only', () => ({}))`, itself or
// through a fixture function it imports and calls, and then loads the module
// with `await import(…)`: a static import runs before any mock. A mock at
// module level counts for a load inside a function, which runs when a test
// calls it, and for a later module-level load. A mock inside a function
// counts only for a later load in the same function. Modules the test mocks
// are not followed.

/** `scope` is the enclosing function, or null at module level. */
type Load = { specifier: string; position: number; dynamic: boolean; scope: ts.Node | null };
type Mock = { specifier: string; position: number; scope: ts.Node | null };

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
}

/** Whether an import or re-export declaration loads its module at runtime. */
function loadsAtRuntime(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  // TypeScript drops an import whose every named binding is a type.
  return !(
    !clause.name &&
    bindings &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

/** The specifiers a module loads statically at runtime. */
function staticLoads(source: ts.SourceFile): Load[] {
  return source.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    loadsAtRuntime(statement)
      ? [
          {
            specifier: statement.moduleSpecifier.text,
            position: statement.getStart(source),
            dynamic: false,
            scope: null,
          },
        ]
      : [],
  );
}

/**
 * A module's `import('…')` calls and its `mock.module('…')` calls. A call of
 * one of `fixtureMocks`, imported fixture functions that mock 'server-only',
 * counts as such a mock.
 */
function callsOf(
  source: ts.SourceFile,
  fixtureMocks: ReadonlySet<string> = new Set(),
): { loads: Load[]; mocks: Mock[] } {
  const loads: Load[] = [];
  const mocks: Mock[] = [];
  const visit = (node: ts.Node, scope: ts.Node | null): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const specifier = first && ts.isStringLiteralLike(first) ? first.text : null;
      const position = node.getStart(source);
      if (specifier !== null && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        loads.push({ specifier, position, dynamic: true, scope });
      if (
        specifier !== null &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'mock' &&
        node.expression.name.text === 'module'
      )
        mocks.push({ specifier, position, scope });
      if (ts.isIdentifier(node.expression) && fixtureMocks.has(node.expression.text))
        mocks.push({ specifier: 'server-only', position, scope });
    }
    ts.forEachChild(node, (child) => visit(child, ts.isFunctionLike(node) ? node : scope));
  };
  visit(source, null);
  return { loads, mocks };
}

/** Whether a mock has run when a load runs: see the rule above. */
function mockRunsFirst(mock: Mock, load: Load): boolean {
  if (!load.dynamic) return false;
  if (mock.scope === null) return load.scope !== null || mock.position < load.position;
  return mock.scope === load.scope && mock.position < load.position;
}

/** The local names an import declaration binds at runtime. */
function importedNames(statement: ts.ImportDeclaration): string[] {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return [];
  const bindings = clause.namedBindings;
  return [
    ...(clause.name ? [clause.name.text] : []),
    ...(bindings && ts.isNamedImports(bindings)
      ? bindings.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text)
      : []),
  ];
}

/**
 * The import chain from `file` to 'server-only', skipping the modules in
 * `mocked`, or null when none exists.
 */
function chainToServerOnly(
  file: string,
  mocked: ReadonlySet<string>,
  edges: (file: string) => string[],
): string[] | null {
  const visited = new Set<string>();
  const visit = (current: string): string[] | null => {
    if (mocked.has(current)) return null;
    if (current === 'server-only') return ['server-only'];
    if (visited.has(current)) return null;
    visited.add(current);
    for (const next of edges(current)) {
      const chain = visit(next);
      if (chain) return [current, ...chain];
    }
    return null;
  };
  return visit(file);
}

/** Each test file's load that reaches 'server-only' without a server-only mock of its own first. */
function unmockedServerOnlyLoads(testFiles: readonly string[], host: SourceHost): string[] {
  const parsed = new Map<string, ts.SourceFile | null>();
  const sourceOf = (file: string): ts.SourceFile | null => {
    if (!parsed.has(file)) {
      const text = host(file);
      parsed.set(file, text === null ? null : parse(file, text));
    }
    return parsed.get(file) ?? null;
  };
  // A module's runtime imports: product files and the 'server-only' package itself.
  const target = (importer: string, specifier: string): string | null =>
    specifier === 'server-only' ? 'server-only' : resolveProductModule(importer, specifier, host);
  const edgeCache = new Map<string, string[]>();
  const edges = (file: string): string[] => {
    const known = edgeCache.get(file);
    if (known) return known;
    const source = sourceOf(file);
    const found = source ? staticLoads(source).flatMap(({ specifier }) => target(file, specifier) ?? []) : [];
    edgeCache.set(file, found);
    return found;
  };
  const findings: string[] = [];
  for (const file of testFiles) {
    const source = sourceOf(file);
    if (!source) continue;
    // The functions of an imported fixture that registers the mock, by local name.
    const fixtureMocks = new Set(
      source.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
        const fixture = target(file, statement.moduleSpecifier.text);
        const fixtureSource = fixture && fixture !== 'server-only' ? sourceOf(fixture) : null;
        return fixtureSource && callsOf(fixtureSource).mocks.some((mock) => mock.specifier === 'server-only')
          ? importedNames(statement)
          : [];
      }),
    );
    const own = callsOf(source, fixtureMocks);
    for (const load of [...staticLoads(source), ...own.loads]) {
      const loaded = target(file, load.specifier);
      if (loaded === null) continue;
      const mocked = new Set(
        own.mocks.flatMap((mock) => (mockRunsFirst(mock, load) ? (target(file, mock.specifier) ?? []) : [])),
      );
      const chain = chainToServerOnly(loaded, mocked, edges);
      if (chain) findings.push(`${file}: ${load.specifier} -> ${chain.join(' -> ')}`);
    }
  }
  return findings;
}

/** The unit test files: `bun test` runs lib/ only (bunfig.toml). */
function unitTestFiles(): string[] {
  return readdirSync(resolve(repositoryRoot, 'lib'), { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.test\.(?:ts|tsx|mjs)$/.test(name))
    .map((name) => `lib/${name.replaceAll('\\', '/')}`)
    .sort();
}

test('every unit test that loads a server-only module mocks server-only first, itself', () => {
  expect(
    unmockedServerOnlyLoads(unitTestFiles(), repositorySources),
    "Call mock.module('server-only', () => ({})) in the test file, then load the module with await import(…). A static import runs before any mock.",
  ).toEqual([]);
});

test('probe: a load reaching server-only fails unless the file mocks it before a dynamic import', () => {
  const files: Record<string, string> = {
    'lib/area/reader.ts': "import 'server-only';\nexport const read = 1;",
    'lib/area/wrapper.ts': "import { read } from './reader';\nexport const wrapped = read;",
    'lib/area/types.ts': "import type { X } from './reader';\nexport type Y = X;",
    'lib/area/fixture.ts': "export function isolate() { mock.module('server-only', () => ({})); }",
    'lib/area/static.test.ts': "import { wrapped } from './wrapper';",
    'lib/area/unmocked.test.ts': "test('x', async () => { await import('./wrapper'); });",
    'lib/area/late.test.ts':
      "const { read } = await import('./reader');\nmock.module('server-only', () => ({}));",
    'lib/area/good.test.ts': "mock.module('server-only', () => ({}));\nconst m = await import('./wrapper');",
    'lib/area/deferred.test.ts':
      "async function load() { return import('./reader'); }\nmock.module('server-only', () => ({}));",
    'lib/area/fixture.test.ts': "import { isolate } from './fixture';\nisolate();\nawait import('./reader');",
    'lib/area/cut.test.ts':
      "mock.module('@/lib/area/reader', () => ({ read: 2 }));\nconst m = await import('./wrapper');",
    'lib/area/type-only.test.ts':
      "import type { Y } from './types';\nimport { type X } from './reader';\nexport type Z = Y | X;",
    'lib/area/static-with-mock.test.ts':
      "import { read } from './reader';\nmock.module('server-only', () => ({}));",
    'lib/area/uncalled-fixture.test.ts': "import { isolate } from './fixture';\nawait import('./reader');",
    'lib/area/fixture-late.test.ts':
      "import { isolate } from './fixture';\nawait import('./reader');\nisolate();",
    'lib/area/later-test.test.ts':
      "test('a', async () => { await import('./reader'); });\ntest('b', () => { mock.module('server-only', () => ({})); });",
    'lib/area/same-test.test.ts':
      "test('a', async () => { mock.module('server-only', () => ({})); await import('./reader'); });",
    'lib/area/explicit.test.ts': "import { read } from './reader.ts';",
    'lib/area/plain.test.mjs': "import { read } from './reader';",
  };
  const host: SourceHost = (file) => files[file] ?? null;
  const tests = Object.keys(files).filter((file) => /\.test\.(?:ts|mjs)$/.test(file));
  expect(unmockedServerOnlyLoads(tests, host)).toEqual([
    'lib/area/static.test.ts: ./wrapper -> lib/area/wrapper.ts -> lib/area/reader.ts -> server-only',
    'lib/area/unmocked.test.ts: ./wrapper -> lib/area/wrapper.ts -> lib/area/reader.ts -> server-only',
    'lib/area/late.test.ts: ./reader -> lib/area/reader.ts -> server-only',
    'lib/area/static-with-mock.test.ts: ./reader -> lib/area/reader.ts -> server-only',
    'lib/area/uncalled-fixture.test.ts: ./reader -> lib/area/reader.ts -> server-only',
    'lib/area/fixture-late.test.ts: ./reader -> lib/area/reader.ts -> server-only',
    'lib/area/later-test.test.ts: ./reader -> lib/area/reader.ts -> server-only',
    'lib/area/explicit.test.ts: ./reader.ts -> lib/area/reader.ts -> server-only',
    'lib/area/plain.test.mjs: ./reader -> lib/area/reader.ts -> server-only',
  ]);
});
