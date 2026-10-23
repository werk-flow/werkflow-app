import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { resolveSpecifier } from './action-prechecks-scan';
import { repositoryRoot } from './product-sources';

// How the convention scans that follow calls across files resolve an import:
// lib/conventions/live-view-reads.test.ts and lib/conventions/related-writes.test.ts.
// A scan reads sources through a host, so its probes plant files in memory.

/** Repository-relative source text by path, or null when no such file exists. */
export type SourceHost = (file: string) => string | null;

export const repositorySources: SourceHost = (file) => {
  const path = resolve(repositoryRoot, file);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
};

const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** The product module an `@/` or relative specifier names, or null for a package or a file the host lacks. */
export function resolveModuleFile(importer: string, specifier: string, host: SourceHost): string | null {
  const base = resolveSpecifier(importer, specifier);
  if (base === null) return null;
  return (
    MODULE_EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => host(path) !== null) ?? null
  );
}

/** The named, non-type bindings of an import or re-export declaration, as local name and exported name. */
export function namedBindings(statement: ts.Statement): Array<{ local: string; exported: string }> {
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

/** The module specifier text of an import or re-export declaration, or null for any other statement. */
export function moduleSpecifierOf(statement: ts.Statement): string | null {
  return (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
    ? statement.moduleSpecifier.text
    : null;
}
