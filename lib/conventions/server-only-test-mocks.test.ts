import { expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { repositorySources, resolveModuleFile, type SourceHost } from './module-imports';
import { repositoryRoot } from './product-sources';

// Rule test: docs/technical/testing.md, "Never". One process runs every unit
// test file, and a `mock.module` stays registered for the files after it
// (scripts/run-unit-tests.ts). A test that loads a module importing
// 'server-only' without mocking 'server-only' itself passes only behind an
// earlier file's mock, and fails when run alone, first, or in another part.
//
// Such a test calls `mock.module('server-only', () => ({}))`, itself or
// through a fixture it imports, and then loads the module with
// `await import(…)`: a static import runs before any mock. A top-level load
// must follow the mock in the text; a load inside a function runs when the
// test calls it, so any mock of the file counts. Modules the test mocks are
// not followed.

type Load = { specifier: string; position: number; dynamic: boolean; topLevel: boolean };
type Mock = { specifier: string; position: number };

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
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
            topLevel: true,
          },
        ]
      : [],
  );
}

/** A module's `import('…')` calls and its `mock.module('…')` calls. */
function callsOf(source: ts.SourceFile): { loads: Load[]; mocks: Mock[] } {
  const loads: Load[] = [];
  const mocks: Mock[] = [];
  const visit = (node: ts.Node, topLevel: boolean): void => {
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const specifier = first && ts.isStringLiteralLike(first) ? first.text : null;
      const position = node.getStart(source);
      if (specifier !== null && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        loads.push({ specifier, position, dynamic: true, topLevel });
      if (
        specifier !== null &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'mock' &&
        node.expression.name.text === 'module'
      )
        mocks.push({ specifier, position });
    }
    ts.forEachChild(node, (child) => visit(child, topLevel && !ts.isFunctionLike(node)));
  };
  visit(source, true);
  return { loads, mocks };
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
    specifier === 'server-only' ? 'server-only' : resolveModuleFile(importer, specifier, host);
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
    const own = callsOf(source);
    const imports = staticLoads(source);
    // A fixture the test imports may register the mock when the test calls it.
    const fixtureMocksServerOnly = imports.some(({ specifier }) => {
      const fixture = target(file, specifier);
      const fixtureSource = fixture && fixture !== 'server-only' ? sourceOf(fixture) : null;
      return (
        fixtureSource !== null &&
        callsOf(fixtureSource).mocks.some((mock) => mock.specifier === 'server-only')
      );
    });
    for (const load of [...imports, ...own.loads]) {
      const loaded = target(file, load.specifier);
      if (loaded === null) continue;
      const mocked = new Set(
        load.dynamic
          ? [
              ...own.mocks.flatMap((mock) =>
                !load.topLevel || mock.position < load.position ? (target(file, mock.specifier) ?? []) : [],
              ),
              ...(fixtureMocksServerOnly ? ['server-only'] : []),
            ]
          : [],
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
    .filter((name) => /\.test\.tsx?$/.test(name))
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
  };
  const host: SourceHost = (file) => files[file] ?? null;
  const tests = Object.keys(files).filter((file) => file.endsWith('.test.ts'));
  expect(unmockedServerOnlyLoads(tests, host)).toEqual([
    'lib/area/static.test.ts: ./wrapper -> lib/area/wrapper.ts -> lib/area/reader.ts -> server-only',
    'lib/area/unmocked.test.ts: ./wrapper -> lib/area/wrapper.ts -> lib/area/reader.ts -> server-only',
    'lib/area/late.test.ts: ./reader -> lib/area/reader.ts -> server-only',
    'lib/area/static-with-mock.test.ts: ./reader -> lib/area/reader.ts -> server-only',
  ]);
});
