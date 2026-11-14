import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

// Tier 2 for the invoice core's boundary: E13 issues WerkFlow's own invoices
// through the same core, so it imports no database, organization or Supabase
// module, and no renderer (the renderer imports the core, never the reverse).

const FORBIDDEN = [
  /^@\/lib\/document-rendering(\/|$)/,
  /^@\/lib\/supabase(\/|$)/,
  /^@\/lib\/org(\/|$)/,
  /^@\/app(\/|$)/,
  /^@supabase\//,
];
const IMPORT = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

const ROOT = resolve(import.meta.dir);
const REPO = resolve(ROOT, '../..');

/** A relative specifier as the `@/` path it reaches, so `../document-rendering/x` is caught too. */
function asAlias(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier;
  return `@/${relative(REPO, resolve(ROOT, dirname(file), specifier))}`;
}

/** Every forbidden import in the given source, as `file: specifier`. */
function forbiddenImports(file: string, source: string): string[] {
  return [...source.matchAll(IMPORT)].flatMap(([, specifier = '']) =>
    FORBIDDEN.some((pattern) => pattern.test(asAlias(file, specifier))) ? [`${file}: ${specifier}`] : [],
  );
}

test('nothing in lib/invoicing/ imports a renderer, database, organization or app module', () => {
  const found = readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && name !== 'core-boundary.test.ts')
    .flatMap((name) => forbiddenImports(name, readFileSync(resolve(ROOT, name), 'utf8')));
  expect(found).toEqual([]);
});

test('the scan finds static, type and dynamic imports of a forbidden module', () => {
  const sample = [
    "import { renderEInvoicePdf } from '@/lib/document-rendering/e-invoice';",
    "import type { Database } from '@/lib/supabase/database.types';",
    "const org = await import('@/lib/org/action-context');",
    "import { lineAmountCents } from '@/lib/inventory/line-amount';",
    "import { renderBusinessDocument } from '../document-rendering/render';",
    "import { calculateInvoice } from './calculate';",
  ].join('\n');
  expect(forbiddenImports('sample.ts', sample)).toEqual([
    'sample.ts: @/lib/document-rendering/e-invoice',
    'sample.ts: @/lib/supabase/database.types',
    'sample.ts: @/lib/org/action-context',
    'sample.ts: ../document-rendering/render',
  ]);
});
