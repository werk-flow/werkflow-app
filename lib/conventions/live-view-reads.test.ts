import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// Tier 2 for the background-read registry: a live view reads on mount, on a
// Realtime event and beside a save, so its `read` must not call a Server
// Action. One browser client's Server Actions run one after another, and a
// queued read delays the user's next save. The scan starts at the `read` of
// every live view (and, below, at every effect) and follows each function it
// calls: a same-file function, and a function imported by name from another
// product module that is not `'use server'`, recursively. A call to an import
// from a `'use server'` module is a finding, reported where that call is
// written, so a wrapper in another file is found at the wrapper.
//
// What the scan cannot follow statically, and why:
// - a function passed in as a parameter or a prop (`onLoad`, a callback): the
//   value is chosen by the caller at run time;
// - a function returned by a hook and destructured (`const { reload } =
//   useFoo()`): the scan follows names, not values; the hook's own effects and
//   reads are scanned where the hook is written;
// - a default or namespace import, and a method called on an object
//   (`api.read()`): no product module exports a reader that way;
// - a package outside the repository: it cannot import a product Server Action.

const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Repository-relative source text by path, or null when no such file exists. */
type SourceHost = (file: string) => string | null;

const repositorySources: SourceHost = (file) => {
  const path = resolve(repositoryRoot, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

type ImportedName = { file: string; name: string };
type FileContext = {
  file: string;
  source: ts.SourceFile;
  /** Local names imported from a `'use server'` module. */
  serverNames: Set<string>;
  /** Local names imported by name from another product module. */
  imports: Map<string, ImportedName>;
  /** Function bodies of this file by name. */
  functions: Map<string, ts.Node>;
};

function moduleBase(importer: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(importer), specifier));
  return null;
}

function isServerActionSource(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

/** Same-file function bodies by name, so a call to a declared or arrow function is followed. */
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

/** The named, non-type bindings of an import or re-export declaration, as local name and exported name. */
function namedBindings(statement: ts.Statement): Array<{ local: string; exported: string }> {
  if (ts.isImportDeclaration(statement)) {
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.isTypeOnly) return [];
    return bindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => ({
        local: element.name.text,
        exported: (element.propertyName ?? element.name).text,
      }));
  }
  if (
    ts.isExportDeclaration(statement) &&
    statement.exportClause &&
    ts.isNamedExports(statement.exportClause)
  ) {
    if (statement.isTypeOnly) return [];
    return statement.exportClause.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => ({
        local: element.name.text,
        exported: (element.propertyName ?? element.name).text,
      }));
  }
  return [];
}

/**
 * The scan over one source host. Contexts are parsed once per file; a module
 * that is not found (a package, an asset) is never followed.
 */
function createScanner(host: SourceHost) {
  const sources = new Map<string, ts.SourceFile | null>();
  const contexts = new Map<string, FileContext | null>();

  function resolveModule(importer: string, specifier: string): string | null {
    const base = moduleBase(importer, specifier);
    if (base === null) return null;
    return (
      MODULE_EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => host(path) !== null) ?? null
    );
  }

  function sourceOf(file: string): ts.SourceFile | null {
    if (!sources.has(file)) {
      const text = host(file);
      sources.set(file, text === null ? null : parseProductSource(file, text));
    }
    return sources.get(file) ?? null;
  }

  // A context is built only for a file the scan starts in or follows into.
  function contextOf(file: string): FileContext | null {
    if (!contexts.has(file)) {
      const source = sourceOf(file);
      contexts.set(file, source === null ? null : buildContext(file, source));
    }
    return contexts.get(file) ?? null;
  }

  function buildContext(file: string, source: ts.SourceFile): FileContext {
    const serverNames = new Set<string>();
    const imports = new Map<string, ImportedName>();
    for (const statement of source.statements) {
      const specifier =
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      if (specifier === null) continue;
      const target = resolveModule(file, specifier);
      const targetSource = target === null ? null : sourceOf(target);
      if (target === null || !targetSource) continue;
      for (const binding of namedBindings(statement)) {
        if (isServerActionSource(targetSource)) serverNames.add(binding.local);
        else imports.set(binding.local, { file: target, name: binding.exported });
      }
    }
    return { file, source, serverNames, imports, functions: localFunctions(source) };
  }

  /** The function an import names: declared in its module, or re-exported from a further one. */
  function importedFunction(imported: ImportedName, seen = new Set<string>()): [FileContext, ts.Node] | null {
    const key = `${imported.file} ${imported.name}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const context = contextOf(imported.file);
    if (context === null) return null;
    const local = context.functions.get(imported.name);
    if (local) return [context, local];
    const forwarded = context.imports.get(imported.name);
    return forwarded ? importedFunction(forwarded, seen) : null;
  }

  /** Server Action imports the roots reach, directly or through followed functions, as `file:line name`. */
  function serverActionCallsFrom(file: string, roots: (source: ts.SourceFile) => ts.Node[]): string[] {
    const root = contextOf(file);
    if (root === null) return [];
    const findings: string[] = [];
    const visited = new Set<ts.Node>();
    function follow(context: FileContext, node: ts.Node): void {
      if (visited.has(node)) return;
      visited.add(node);
      const parent = node.parent;
      const isMemberName =
        (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node;
      if (ts.isIdentifier(node) && !isMemberName) followName(context, node);
      ts.forEachChild(node, (child) => follow(context, child));
    }
    function followName(context: FileContext, node: ts.Identifier): void {
      if (context.serverNames.has(node.text)) {
        const line = context.source.getLineAndCharacterOfPosition(node.getStart(context.source)).line + 1;
        findings.push(`${context.file}:${line} ${node.text}`);
      }
      const local = context.functions.get(node.text);
      if (local) return follow(context, local);
      const imported = context.imports.get(node.text);
      const target = imported ? importedFunction(imported) : null;
      if (target) follow(target[0], target[1]);
    }
    for (const start of roots(root.source)) {
      // `read: loadRows` and the shorthand `read` reach the named function.
      follow(root, ts.isShorthandPropertyAssignment(start) ? start.name : start);
    }
    return [...new Set(findings)];
  }

  return { serverActionCallsFrom };
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

/**
 * What runs on mount and on a dependency change: the first argument of every
 * `useEffect` and `useLayoutEffect` call, and the `read` of every
 * `useClientRead` call, which hooks/use-client-read.ts starts from an effect.
 */
function effectCallbacks(node: ts.Node, found: ts.Node[] = []): ts.Node[] {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === 'useEffect' || node.expression.text === 'useLayoutEffect') &&
    node.arguments[0]
  )
    found.push(node.arguments[0]);
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'useClientRead' &&
    node.arguments[0] &&
    ts.isObjectLiteralExpression(node.arguments[0])
  ) {
    for (const property of node.arguments[0].properties) {
      if (property.name && ts.isIdentifier(property.name) && property.name.text === 'read')
        found.push(property);
    }
  }
  ts.forEachChild(node, (child) => void effectCallbacks(child, found));
  return found;
}

const repositoryScanner = createScanner(repositorySources);

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
    .flatMap((file) => repositoryScanner.serverActionCallsFrom(file, (source) => liveViewReads(source)));
  expect(
    findings,
    'A live view read queues behind the user’s saves when it calls a Server Action. Register the reader in lib/data/background-reads.ts and call readInBackground with the read signal.',
  ).toEqual([]);
});

// The same queue rule for work an effect starts on mount or on a dependency
// change: a read goes through the background-read registry or comes with the
// server props. Only writes the effect must start remain, each with its
// reason; the list only shrinks, and a new site fails. A site is keyed by the
// file that writes the Server Action call, which may be a wrapper the effect
// reaches in another file.
const UPLOAD_WRITE =
  'a write: the upload dialog starts the upload the user chose when it opens; its folders and files are the save itself';
const EFFECT_STARTED_ACTIONS: Readonly<Record<string, string>> = {
  'components/dokumente/document-upload-dialog.tsx createDocumentFolder': UPLOAD_WRITE,
  // Reached from the same upload dialog effect through uploadDocumentDirect.
  'lib/documents/upload-client.ts createDocumentUploadTicket': UPLOAD_WRITE,
  'lib/documents/upload-client.ts finalizeDocumentUpload': UPLOAD_WRITE,
  'components/organization/organization-context.tsx setActiveOrgCookie':
    'a write: a Server Component cannot set a cookie, so the client stores the organization the server resolved from a fallback, once per mount',
};

test('no effect starts a Server Action outside the reviewed list', () => {
  const found = listProductSources(['components', 'hooks', 'app'])
    .flatMap((file) => repositoryScanner.serverActionCallsFrom(file, (source) => effectCallbacks(source)))
    .map((finding) => finding.replace(/:\d+ /, ' '));
  const sites = [...new Set(found)];
  expect(
    sites.filter((site) => !(site in EFFECT_STARTED_ACTIONS)),
    'An effect that calls a Server Action queues behind the user’s saves. Take the data from the server props, or register the reader in lib/data/background-reads.ts and call readInBackground.',
  ).toEqual([]);
  expect(Object.keys(EFFECT_STARTED_ACTIONS).filter((site) => !sites.includes(site))).toEqual([]);
});

describe('the scan follows wrappers across files', () => {
  const planted: Record<string, string> = {
    'components/probe/actions.ts': `'use server';\nexport async function readThing() { return { success: true }; }\n`,
    'components/probe/wrapper.ts': `import { readThing } from './actions';\nexport function loadThing() { return readThing(); }\n`,
    'components/probe/nested.ts': `import { loadThing as load } from '@/components/probe/wrapper';\nexport const deeper = () => load();\n`,
    'components/probe/barrel.ts': `export { deeper } from './nested';\n`,
    'components/probe/plain.ts': `export function formatThing() { return 1; }\n`,
    'components/probe/cycle-a.ts': `import { b } from './cycle-b';\nexport function a(): number { return b(); }\n`,
    'components/probe/cycle-b.ts': `import { a } from './cycle-a';\nexport function b(): number { return a(); }\n`,
    'components/probe/site.tsx': `import { useEffect } from 'react';\nimport { deeper } from './barrel';\nexport function Site() { useEffect(() => { void deeper(); }, []); return null; }\n`,
    'components/probe/plain-site.tsx': `import { useEffect } from 'react';\nimport { formatThing } from './plain';\nimport { a } from './cycle-a';\nexport function Site() { useEffect(() => { formatThing(); a(); }, []); return null; }\n`,
    'components/probe/read-site.tsx': `import { useClientRead } from '@/hooks/use-client-read';\nimport { loadThing } from './wrapper';\nexport function Site() { useClientRead({ read: () => loadThing(), deps: [] }); return null; }\n`,
  };
  const scanner = createScanner((file) => planted[file] ?? null);
  const scan = (file: string) => scanner.serverActionCallsFrom(file, (source) => effectCallbacks(source));

  test('an effect that reaches a Server Action through a re-exported, renamed wrapper in two other files is found at the wrapper', () => {
    expect(scan('components/probe/site.tsx')).toEqual(['components/probe/wrapper.ts:2 readThing']);
  });

  test('an effect that reaches only plain helpers, also through an import cycle, is clean', () => {
    expect(scan('components/probe/plain-site.tsx')).toEqual([]);
  });

  test('a useClientRead read that calls a wrapper in another file is found', () => {
    expect(scan('components/probe/read-site.tsx')).toEqual(['components/probe/wrapper.ts:2 readThing']);
  });
});
