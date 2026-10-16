import { expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import { repositoryRoot } from './product-sources';

// Rule test: docs/technical/performance.md, Never. A server primitive that
// every page renders (PageShell, PageBody, the page headers) imports no
// `'use client'` product module, directly or through other server modules.
// A client component inside such a primitive puts its client reference, with
// the whole chunk list of the route, into every route payload and every
// `loading.tsx` skeleton: the 2026-10-16 lab runs measured 1.2 to 1.5 KB per
// payload and a split job prefetch. Page-wide client behaviour runs once in
// the app shell (`components/sidebar/app-shell.tsx`). Package imports such as
// `next/link` are out of scope: their references are shared by every route.

const PAGE_PRIMITIVES = [
  'components/shared/page-shell.tsx',
  'components/shared/page-header.tsx',
  'components/shared/subpage-header.tsx',
  'components/shared/detail-page-header.tsx',
] as const;

const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

type SourceReader = {
  /** The text of a repository-relative file, or null when it does not exist. */
  read: (file: string) => string | null;
};

function isClientModule(text: string, file: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

/** Repository-relative target of a product import, or null for a package. */
function resolveImport(importer: string, specifier: string, reader: SourceReader): string | null {
  const base = specifier.startsWith('@/')
    ? specifier.slice(2)
    : specifier.startsWith('.')
      ? posix.join(posix.dirname(importer), specifier)
      : null;
  if (base === null) return null;
  return (
    EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => reader.read(path) !== null) ?? null
  );
}

/** Value imports (type-only imports leave no reference) of one module. */
function valueImports(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(statement)
        ? statement.importClause?.isTypeOnly === true
        : statement.isTypeOnly;
      if (!typeOnly) specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
}

/** `'use client'` product modules a server primitive reaches, as `primitive -> module`. */
function clientReferencesOf(primitive: string, reader: SourceReader): string[] {
  const findings: string[] = [];
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const text = reader.read(file);
    if (text === null) return;
    if (isClientModule(text, file)) {
      findings.push(`${primitive} -> ${file}`);
      return;
    }
    for (const specifier of valueImports(file, text)) {
      const target = resolveImport(file, specifier, reader);
      if (target !== null) visit(target);
    }
  };
  visit(primitive);
  return findings;
}

const repositoryReader: SourceReader = {
  read: (file) => {
    const path = resolve(repositoryRoot, file);
    return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
  },
};

function memoryReader(files: Record<string, string>): SourceReader {
  return { read: (file) => files[file] ?? null };
}

test('the server page primitives import no client module', () => {
  const findings = PAGE_PRIMITIVES.flatMap((primitive) => clientReferencesOf(primitive, repositoryReader));
  expect(
    findings,
    'A client component inside a primitive every page renders puts its client reference into every route payload. Run page-wide client behaviour once in components/sidebar/app-shell.tsx.',
  ).toEqual([]);
});

test('probe: a client module reached from a server primitive fails, a server-only chain passes', () => {
  const planted = memoryReader({
    'components/shared/page-shell.tsx':
      "import { PageBodyScroll } from './page-body-scroll';\nimport type { Props } from './props';\nexport const x = 1;",
    'components/shared/page-body-scroll.tsx': "'use client';\nexport function PageBodyScroll() {}",
    'components/shared/props.ts': "'use client';\nexport type Props = {};",
  });
  expect(clientReferencesOf('components/shared/page-shell.tsx', planted)).toEqual([
    'components/shared/page-shell.tsx -> components/shared/page-body-scroll.tsx',
  ]);
  const transitive = memoryReader({
    'components/shared/page-header.tsx':
      "import { title } from '@/lib/title';\nimport Link from 'next/link';",
    'lib/title.ts': "import { Widget } from '@/components/widget';\nexport const title = 1;",
    'components/widget.tsx': "'use client';\nexport function Widget() {}",
  });
  expect(clientReferencesOf('components/shared/page-header.tsx', transitive)).toEqual([
    'components/shared/page-header.tsx -> components/widget.tsx',
  ]);
  const clean = memoryReader({
    'components/shared/page-shell.tsx':
      "import { cn } from '@/lib/utils';\nimport type { ReactNode } from 'react';",
    'lib/utils.ts': 'export function cn() {}',
  });
  expect(clientReferencesOf('components/shared/page-shell.tsx', clean)).toEqual([]);
});
