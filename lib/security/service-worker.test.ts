import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

import { resolveSpecifier } from '../conventions/action-prechecks-scan';
import { moduleSpecifierOf, repositorySources, resolveModuleFile } from '../conventions/module-imports';
import { contentDigest } from '../testing/evidence/source-content';

// Rule test: the page clears the caches the service worker owns by their name
// prefix (sign-out, organization switch). A worker cache outside that prefix
// would survive both, so the two copies of the prefix must stay equal.
const root = join(import.meta.dir, '..', '..');
const worker = readFileSync(join(root, 'public', 'sw.js'), 'utf8');
const pageSide = readFileSync(join(root, 'lib', 'offline', 'service-worker-caches.ts'), 'utf8');

test('every cache the service worker opens carries the prefix the page clears', () => {
  const pagePrefix = pageSide.match(/const SERVICE_WORKER_CACHE_PREFIX = '([^']+)';/)?.[1];
  expect(pagePrefix).toBeDefined();
  expect(worker).toContain(`const CACHE_PREFIX = '${pagePrefix}';`);
  const opened = [...worker.matchAll(/caches\.open\(([^)]+)\)/g)].map(([, name]) => name);
  expect(opened).toEqual(['SHELL_CACHE']);
  expect(worker).toMatch(/const SHELL_CACHE = `\$\{CACHE_PREFIX\}/);
});

// Rule test: a sign-in and an organization switch navigate on the client after
// the shell was deleted, so the page asks the worker to refill it. A message the
// worker does not know would leave the device without the offline fallback.
test('the shell refill message the page sends is the one the worker answers', () => {
  const pageMessage = pageSide.match(/const SHELL_REFILL_MESSAGE = '([^']+)';/)?.[1];
  expect(pageMessage).toBeDefined();
  expect(worker).toContain(`const REFILL_MESSAGE = '${pageMessage}';`);
  expect(worker).toMatch(/event\.data === REFILL_MESSAGE\) event\.waitUntil\(ensureShell\(\)\)/);
});

// Rule test: the worker caches every path SHELL_ASSET finds in the offline page,
// and one unfetchable path fails the whole install. A path inside another
// host's URL (a custom Supabase domain such as api.png.example.com, a CDN
// image) is not the app's file and must never match.
test('the shell asset pattern finds only root-relative paths of this origin', () => {
  const source = worker.match(/const SHELL_ASSET = \/(.+)\/g;/)?.[1];
  expect(source).toBeDefined();
  const shellAsset = new RegExp(source ?? '', 'g');
  const html = [
    '<link rel="preconnect" href="https://api.png.example.com">',
    '<img src="https://cdn.example.com/brand.svg">',
    '<script src="/_next/static/chunks/app-1a2b.js"></script>',
    '<img src="/logo-icon-light.svg" srcset="/icons/icon-192.png 1x">',
    'self.__next_f.push([1,"\\"/_next/static/css/app-3c4d.css\\""])',
  ].join('\n');
  expect([...new Set(html.match(shellAsset) ?? [])]).toEqual([
    '/_next/static/chunks/app-1a2b.js',
    '/logo-icon-light.svg',
    '/icons/icon-192.png',
    '/_next/static/css/app-3c4d.css',
  ]);
});

/**
 * What the shell is built from: the offline page, its skeleton and the root layout around both,
 * with every repository file they import for their code or styles. A type-only import is no
 * input, because it leaves nothing in the build. A dependency upgrade alone, and a changed image
 * under public/ that keeps its name, are not counted.
 */
const SHELL_ROOTS = ['app/layout.tsx', 'app/offline/page.tsx', 'app/offline/loading.tsx'];

/** Whether an import or re-export brings code into the build, not only types. */
function bringsCode(statement: ts.Statement): boolean {
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  if (!ts.isImportDeclaration(statement)) return false;
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  return (
    clause.name !== undefined ||
    bindings === undefined ||
    !ts.isNamedImports(bindings) ||
    bindings.elements.some((element) => !element.isTypeOnly)
  );
}

/** The repository files `file` imports for code, `import()` included, and the style sheets it loads. */
function codeImports(file: string, source: string): string[] {
  const specifiers: string[] = [];
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const statement of parsed.statements) {
    const specifier = moduleSpecifierOf(statement);
    if (specifier !== null && bringsCode(statement)) specifiers.push(specifier);
  }
  const visit = (node: ts.Node): void => {
    const [argument] = ts.isCallExpression(node) ? node.arguments : [];
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      argument !== undefined &&
      ts.isStringLiteralLike(argument)
    )
      specifiers.push(argument.text);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return specifiers.flatMap((specifier) => {
    const style = specifier.endsWith('.css') ? resolveSpecifier(file, specifier) : null;
    const resolved = style ?? resolveModuleFile(file, specifier, repositorySources);
    return resolved !== null && repositorySources(resolved) !== null ? [resolved] : [];
  });
}

/** The digest of the shell's inputs at `version`: each file by its comment-free content, and the version. */
function shellInputsDigest(version: number): string {
  const files = new Set<string>();
  const pending = [...SHELL_ROOTS];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const source = repositorySources(file);
    if (files.has(file) || source === null) continue;
    files.add(file);
    if (/\.tsx?$/.test(file)) pending.push(...codeImports(file, source));
  }
  const lines = [...files]
    .sort()
    .map((file) => `${file} ${contentDigest(file, readFileSync(join(root, file)))}`);
  return createHash('sha256')
    .update(`${version}\n${lines.join('\n')}`)
    .digest('hex');
}

// Rule test: a phone keeps the shell it installed until the worker changes, and only a new
// SHELL_VERSION deletes the old cache. A change to the offline page, or to anything it renders
// with, without a new version would leave phones showing the old offline page
// (werk-flow/werkflow-planning#321). The worker names the digest of its inputs next to the
// version, and the digest includes the version, so a recorded digest without a bump fails too.
test('a change to what the shell is built from comes with a new SHELL_VERSION', () => {
  const version = Number(worker.match(/^const SHELL_VERSION = (\d+);$/m)?.[1]);
  expect(Number.isInteger(version)).toBe(true);
  const recorded = worker.match(/^\/\/ Shell inputs of this version: ([0-9a-f]{64})$/m)?.[1];
  const current = shellInputsDigest(version);
  if (recorded === current) return;
  throw new Error(
    `The offline shell's inputs changed since SHELL_VERSION ${version} (public/sw.js). Bump SHELL_VERSION to ${version + 1} and record its inputs: "// Shell inputs of this version: ${shellInputsDigest(version + 1)}".`,
  );
});
