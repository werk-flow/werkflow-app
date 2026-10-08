import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { sourceImportGraph, UNKNOWN_IMPORT_DEPENDENCY } from '../testing/evidence/group-evidence';

// Tier 2 import inventory, not a substitute for checking serialized responses.
// Follow browser dependencies through lib/; Next's server-only and use-server
// boundaries stop traversal because their implementations cannot be bundled.
const repositoryRoot = resolve(import.meta.dir, '../..');
const storageAdapter = 'lib/storage/r2.ts';
const storagePackages = new Set(['@aws-sdk/client-s3', '@aws-sdk/s3-request-presigner']);

function listSources(root: string, directories: readonly string[]): string[] {
  const found: string[] = [];
  function visit(relativePath: string): void {
    for (const entry of readdirSync(resolve(root, relativePath), { withFileTypes: true })) {
      const path = `${relativePath}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
        found.push(path);
    }
  }
  for (const directory of directories) visit(directory);
  return found;
}

function moduleBoundary(source: string): { directives: Set<string>; serverOnly: boolean } {
  const values = new Set<string>();
  const syntax = ts.createSourceFile('module.tsx', source, ts.ScriptTarget.Latest, true);
  for (const statement of syntax.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    values.add(statement.expression.text);
  }
  const serverOnly = syntax.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      !statement.importClause &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'server-only',
  );
  return { directives: values, serverOnly };
}

function storageBoundaryViolations(root: string, files: readonly string[]): string[] {
  const graph = sourceImportGraph(root, files);
  const imports = new Map<string, readonly string[]>();
  const clients: string[] = [];
  const serverBoundaries = new Set<string>();
  for (const file of graph.keys()) {
    const source = readFileSync(resolve(root, file), 'utf8');
    const imported = ts.preProcessFile(source, true, true).importedFiles.map((entry) => entry.fileName);
    const boundary = moduleBoundary(source);
    imports.set(file, imported);
    if (boundary.directives.has('use client')) clients.push(file);
    if (boundary.serverOnly || boundary.directives.has('use server')) serverBoundaries.add(file);
  }
  const violations = new Set<string>();
  // Retain the direct app-root restriction, including relative/dynamic imports.
  for (const file of graph.keys()) {
    if (!/^(app|components|hooks)\//.test(file)) continue;
    if (
      graph.get(file)?.includes(storageAdapter) ||
      imports.get(file)?.some((name) => storagePackages.has(name))
    ) {
      violations.add(`${file}: direct storage implementation import`);
    }
  }
  for (const client of clients) {
    const pending = [client];
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop();
      if (!file || visited.has(file)) continue;
      visited.add(file);
      if (file === UNKNOWN_IMPORT_DEPENDENCY) {
        violations.add(`${client}: unresolved browser import requires review`);
        continue;
      }
      const imported = imports.get(file) ?? [];
      if (serverBoundaries.has(file)) continue;
      if (file === storageAdapter || imported.some((name) => storagePackages.has(name))) {
        violations.add(`${client}: browser reaches ${file}`);
        continue;
      }
      pending.push(...(graph.get(file) ?? []));
    }
  }
  return [...violations].sort();
}

test('browser imports cannot reach raw storage through relative, dynamic, or transitive imports', () => {
  expect(
    storageBoundaryViolations(
      repositoryRoot,
      listSources(repositoryRoot, ['app', 'components', 'hooks', 'lib']),
    ),
  ).toEqual([]);
}, 30_000); // The browser import graph is parsed with the TypeScript AST; 5 s is not enough under host load (incident 2026-09-13).

test('the admin client keeps its build-time server-only guard', () => {
  const source = readFileSync(resolve(repositoryRoot, 'lib/supabase/admin.ts'), 'utf8');
  expect(moduleBoundary(source).serverOnly).toBe(true);
});

function fixture(files: Record<string, string>): string[] {
  const root = mkdtempSync(join(tmpdir(), 'werkflow-storage-boundary-'));
  try {
    for (const [file, source] of Object.entries(files)) {
      const destination = resolve(root, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, source);
    }
    return storageBoundaryViolations(root, Object.keys(files));
  } finally {
    const tempRelative = relative(resolve(tmpdir()), root);
    if (!tempRelative.startsWith('werkflow-storage-boundary-') || tempRelative.includes('..')) {
      throw new Error('Refusing to remove an unexpected fixture directory');
    }
    rmSync(root, { recursive: true, force: true });
  }
}

for (const expression of [
  `import { read } from '../lib/storage/r2';`,
  `const adapter = import('../lib/storage/r2');`,
  `const adapter = require('../lib/storage/r2');`,
]) {
  test(`direct storage import is rejected: ${expression}`, () => {
    expect(
      fixture({
        'components/client.ts': `'use client'; ${expression}`,
        [storageAdapter]: 'export const read = 1;',
      }),
    ).not.toEqual([]);
  });
}

test('transitive barrels, dynamic imports and raw SDK imports are rejected across lib modules', () => {
  for (const implementation of [
    `export * from './storage/r2';`,
    `export const read = () => import('./storage/r2');`,
    `import { S3Client } from '@aws-sdk/client-s3'; export { S3Client };`,
    `export * from '@aws-sdk/s3-request-presigner';`,
  ]) {
    expect(
      fixture({
        'components/client.ts': `'use client'; import { read } from '../lib/barrel';`,
        'lib/barrel.ts': `export * from './helper';`,
        'lib/helper.ts': implementation,
        [storageAdapter]: 'export const read = 1;',
      }),
    ).not.toEqual([]);
  }
});

test('unknown dynamic imports fail closed and supported server boundaries remain usable', () => {
  expect(
    fixture({ 'lib/client.ts': `'use client'; export const load = (name: string) => import(name);` }),
  ).not.toEqual([]);
  for (const boundary of ["'use server';", "import 'server-only';"]) {
    expect(
      fixture({
        'components/client.ts': `'use client'; import { read } from '../lib/server';`,
        'lib/server.ts': `${boundary} import { read } from './storage/r2'; export { read };`,
        [storageAdapter]: 'export const read = 1;',
      }),
    ).toEqual([]);
  }
});

test('an erased type import is not a server-only runtime boundary', () => {
  expect(
    fixture({
      'components/client.ts': `'use client'; import { read } from '../lib/server';`,
      'lib/server.ts': `import type {} from 'server-only'; export { read } from './storage/r2';`,
      [storageAdapter]: 'export const read = 1;',
    }),
  ).not.toEqual([]);
});

// File bytes never pass through a Server Action (docs/technical/security.md,
// "Add a storage path"): the browser uploads to a signed URL. A Server Action
// may still store a file the server generated from trusted rows. The writers
// below are the only callers of putStorageObject; a new caller fails until it
// is reviewed here, and an entry without a caller fails as stale.
const GENERATED_FILE_WRITERS: Record<string, string> = {
  'lib/time-accounts/actions.ts':
    'The payroll ZIP that buildPayrollExportPackage builds from closed-period rows of the caller organization.',
  'lib/work-artifacts/actions.ts':
    'The HTML export that buildWorkArtifactExport renders from the current artifact revision.',
  'lib/work-handover/actions.ts':
    'The HTML handover package that buildCurrentExport renders from the loaded workspace after the holder check.',
};

const BYTE_TYPES = new Set(['File', 'Blob', 'ArrayBuffer', 'Uint8Array', 'ReadableStream', 'Buffer']);
const BYTE_READS = new Set(['arrayBuffer', 'bytes', 'stream']);

function hasServerDirective(source: ts.SourceFile): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    const statements = ts.isSourceFile(node) || ts.isBlock(node) ? node.statements : [];
    for (const statement of statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
      if (statement.expression.text === 'use server') found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Places where a Server Action module accepts or reads client file bytes. */
function serverActionByteInputs(file: string, text: string): string[] {
  // Parsing only directive candidates keeps the scan inside the unit budget.
  if (!text.includes('use server')) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (!hasServerDirective(source)) return [];
  const found: string[] = [];
  const at = (node: ts.Node, what: string): void => {
    found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.type) {
      const types = new Set<string>();
      const collect = (typeNode: ts.Node): void => {
        if (ts.isTypeReferenceNode(typeNode)) types.add(typeNode.typeName.getText(source));
        ts.forEachChild(typeNode, collect);
      };
      collect(node.type);
      for (const name of types) if (BYTE_TYPES.has(name)) at(node, `parameter typed ${name}`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (BYTE_READS.has(name) && node.arguments.length === 0) at(node, `reads bytes with .${name}()`);
      if (node.expression.expression.getText(source) === 'z' && (name === 'file' || name === 'instanceof'))
        at(node, `accepts a file through z.${name}()`);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      BYTE_TYPES.has(node.right.getText(source))
    )
      at(node, `checks instanceof ${node.right.getText(source)}`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('Server Actions never accept file bytes from the client', () => {
  const found = listSources(repositoryRoot, ['app', 'components', 'hooks', 'lib']).flatMap((file) =>
    serverActionByteInputs(file, readFileSync(resolve(repositoryRoot, file), 'utf8')),
  );
  expect(found, 'upload through a signed URL instead (lib/documents/upload-targets.ts)').toEqual([]);
}, 30_000);

test('only the reviewed server-generated files are written with putStorageObject', () => {
  const callers = listSources(repositoryRoot, ['app', 'components', 'hooks', 'lib'])
    .filter((file) => file !== storageAdapter)
    .filter((file) => /\bputStorageObject\s*\(/.test(readFileSync(resolve(repositoryRoot, file), 'utf8')))
    .sort();
  expect(callers, 'a new caller needs a reviewed GENERATED_FILE_WRITERS entry').toEqual(
    Object.keys(GENERATED_FILE_WRITERS).sort(),
  );
});

test('byte inputs of a Server Action are found in every shape', () => {
  const probes = [
    `'use server'; export async function upload(file: File) { return file; }`,
    `'use server'; export async function upload(input: { body: Uint8Array | null }) { return input; }`,
    `'use server'; export async function upload(form: FormData) { const file = form.get('f'); if (file instanceof Blob) return file; }`,
    `'use server'; export async function upload(form: FormData) { return (form.get('f') as Blob).arrayBuffer(); }`,
    `'use server'; const schema = z.object({ file: z.instanceof(File) }); export async function upload(raw: unknown) { return schema.parse(raw); }`,
    `export default function Page() { async function save(file: Blob) { 'use server'; return file; } }`,
  ];
  for (const probe of probes) expect(serverActionByteInputs('lib/probe.ts', probe), probe).not.toEqual([]);
  expect(
    serverActionByteInputs(
      'lib/probe.ts',
      `'use server'; export async function save(form: FormData) { return String(form.get('name') ?? ''); }`,
    ),
  ).toEqual([]);
  expect(
    serverActionByteInputs('lib/probe.ts', `export async function hash(bytes: Uint8Array) { return bytes; }`),
  ).toEqual([]);
});
