import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// The one file walker of the convention tests. A product source is a `.ts` or
// `.tsx` file under app/, components/, hooks/ or lib/; tests, the test harness
// under lib/testing/ and the generated database types are not product code.

export const repositoryRoot = resolve(import.meta.dir, '../..');

export type ProductRoot = 'app' | 'components' | 'hooks' | 'lib';

const PRODUCT_ROOTS: readonly ProductRoot[] = ['app', 'components', 'hooks', 'lib'];
const EXCLUDED_DIRECTORY = 'lib/testing';
const GENERATED_TYPES = 'lib/supabase/database.types.ts';

/** Repository-relative product source paths with forward slashes, sorted. */
export function listProductSources(roots: readonly ProductRoot[] = PRODUCT_ROOTS): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (path !== EXCLUDED_DIRECTORY) visit(path);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.(test|spec)\.tsx?$/.test(entry.name) &&
        !entry.name.endsWith('.d.ts') &&
        path !== GENERATED_TYPES
      ) {
        found.push(path);
      }
    }
  }
  for (const root of roots) visit(root);
  return found.sort();
}

/** The file's text, read from the repository root. */
function readProductSource(file: string): string {
  return readFileSync(resolve(repositoryRoot, file), 'utf8');
}

/** The file parsed with parent pointers, as TSX when its extension says so. */
export function parseProductSource(file: string, text: string = readProductSource(file)): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}
