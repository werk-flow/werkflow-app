import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { listProductSources, parseProductSource } from '@/lib/conventions/product-sources';

const repositoryRoot = resolve(import.meta.dir, '../..');
const fixturePath = resolve(repositoryRoot, 'lib/testing/fixtures/cached-read-failures.ts');

test('a failed cached read throws, caches nothing, and reads again; a time computation fails instead of using defaults', async () => {
  const child = Bun.spawn([process.execPath, fixturePath], {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}, 30_000); // The fixture loads the time-tracking actions in a spawned Bun process; 5 s is not enough under host load.

/** True when the subtree calls a function of this name. */
function callsFunction(node: ts.Node, name: string): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name)
    return true;
  return ts.forEachChild(node, (child) => callsFunction(child, name) || undefined) ?? false;
}

/** The `throw` statements of the subtree. */
function throwStatements(node: ts.Node): ts.ThrowStatement[] {
  const found: ts.ThrowStatement[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isThrowStatement(child)) found.push(child);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** True for a `'use cache'` directive, including its `'use cache: …'` variants. */
function isUseCacheDirective(statement: ts.Statement | undefined): boolean {
  return (
    statement !== undefined &&
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    /^use cache(:|$)/.test(statement.expression.text)
  );
}

/** The name of the module-level declaration that holds a node (the exported reader). */
function ownerName(node: ts.Node): string {
  let topLevel: ts.Node = node;
  while (topLevel.parent && !ts.isSourceFile(topLevel.parent)) topLevel = topLevel.parent;
  if (ts.isFunctionDeclaration(topLevel) && topLevel.name) return topLevel.name.text;
  if (ts.isVariableStatement(topLevel)) {
    const [declaration] = topLevel.declarationList.declarations;
    if (declaration && ts.isIdentifier(declaration.name)) return declaration.name.text;
  }
  return `line ${node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
}

type CachedReader = { file: string; name: string; failsThroughCachedRead: boolean; rawThrows: number };

function describeReader(file: string, name: string, cachedRead: ts.Node): CachedReader {
  return {
    file,
    name,
    failsThroughCachedRead: callsFunction(cachedRead, 'failCachedRead'),
    rawThrows: throwStatements(cachedRead).length,
  };
}

/**
 * A file can only declare a cached reader when its text names `unstable_cache`
 * or a `'use cache'` directive. Git finds those files in the working tree,
 * untracked ones included, and only they are read and parsed: reading and
 * parsing every product source took seconds and timed out under a loaded unit run.
 */
function filesNamingCachedReads(): Set<string> {
  const search = Bun.spawnSync(
    [
      'git',
      'grep',
      '--untracked',
      '-l',
      '-E',
      `unstable_cache|['"]use cache`,
      '--',
      'app',
      'components',
      'hooks',
      'lib',
    ],
    { cwd: repositoryRoot },
  );
  // Exit code 1 means no match; anything else is a failed search, never an empty result.
  if (search.exitCode !== 0 && search.exitCode !== 1)
    throw new Error(`git grep failed: ${search.stderr.toString()}`);
  return new Set(search.stdout.toString().split(/\r?\n/).filter(Boolean));
}
let discoveredReaders: CachedReader[] | undefined;

/**
 * Every cross-request cached read in the product sources: the function passed
 * to `unstable_cache`, and every function a `'use cache'` directive caches
 * (in its own body, or in the whole module).
 */
function crossRequestReaders(): CachedReader[] {
  if (discoveredReaders) return discoveredReaders;
  const readers: CachedReader[] = [];
  const candidates = filesNamingCachedReads();
  for (const file of listProductSources().filter((path) => candidates.has(path))) {
    const source = parseProductSource(file);
    const moduleCached = isUseCacheDirective(source.statements[0]);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'unstable_cache' &&
        node.arguments[0] !== undefined
      ) {
        readers.push(describeReader(file, ownerName(node), node.arguments[0]));
      }
      if (isFunctionNode(node) && node.body && ts.isBlock(node.body)) {
        const exportedFromCachedModule =
          moduleCached &&
          node.parent === source &&
          (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
        if (isUseCacheDirective(node.body.statements[0]) || exportedFromCachedModule)
          readers.push(describeReader(file, ownerName(node), node.body));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  discoveredReaders = readers;
  return readers;
}

// The reader list is discovered from the product sources, so a new
// cross-request reader anywhere fails here until it fails through
// failCachedRead (which throws CachedReadError after a classified log) and
// throws nothing raw. The readers of lib/data/cached.ts must also be driven by
// the fixture above, which proves that they throw, store nothing and read again.
test('every cross-request cached reader throws CachedReadError on a failed read', () => {
  const readers = crossRequestReaders();
  expect(readers.filter((reader) => reader.file === 'lib/data/cached.ts').length).toBeGreaterThan(0);
  expect(
    readers
      .filter((reader) => !reader.failsThroughCachedRead || reader.rawThrows > 0)
      .map((reader) => `${reader.file}#${reader.name}`),
    'A cached read must end a failure in failCachedRead (throw CachedReadError), never return a fallback value that the cache would store or throw a raw error that carries a provider message.',
  ).toEqual([]);
});

test('every cached reader of lib/data/cached.ts is driven by the failure fixture', () => {
  const fixture = readFileSync(fixturePath, 'utf8');
  const driven = new Set(
    [...fixture.matchAll(/read: \(\) => cached\.(\w+)\(/g)].flatMap((match) => (match[1] ? [match[1]] : [])),
  );
  const exported = new Set(
    parseProductSource('lib/data/cached.ts').statements.flatMap((statement) => {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
      if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) return [];
      if (ts.isFunctionDeclaration(statement) && statement.name) return [statement.name.text];
      if (!ts.isVariableStatement(statement)) return [];
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    }),
  );
  const readers = crossRequestReaders().filter(
    (reader) => reader.file === 'lib/data/cached.ts' && exported.has(reader.name),
  );
  expect(readers.length).toBeGreaterThan(0);
  expect(
    readers.map((reader) => reader.name).filter((name) => !driven.has(name)),
    'Add an expectNoCachedFailure case for each new reader to lib/testing/fixtures/cached-read-failures.ts.',
  ).toEqual([]);
});
