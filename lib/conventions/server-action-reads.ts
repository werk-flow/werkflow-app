import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';

import { repositoryRoot } from './product-sources';
import reviewedReads from './reviewed-read-actions.json';

// Which Server Actions only read (AGENTS.md "2. Performance and immediate
// feedback"), for lib/conventions/server-action-feedback.test.ts. An action is
// a read when the background-read registry imports it, or when
// reviewed-read-actions.json names it (`module#name` -> why it writes
// nothing). Every other Server Action writes, whatever its name, so a write
// renamed `getX` still needs first-frame feedback.

const BACKGROUND_READ_REGISTRY = 'lib/data/background-reads.ts';

/** `module#name` -> why this user-started Server Action writes nothing. */
const REVIEWED_READS: Readonly<Record<string, string>> = reviewedReads;

/** Background reads that start without a Server Action (lib/data/background-reads.ts). */
export const READ_CALLS: ReadonlySet<string> = new Set(['readInBackground']);

let registry: ReadonlySet<string> | undefined;

/** `module#name` of every value the registry imports from a product module. */
function registryReads(): ReadonlySet<string> {
  if (registry) return registry;
  const source = ts.createSourceFile(
    BACKGROUND_READ_REGISTRY,
    readFileSync(resolve(repositoryRoot, BACKGROUND_READ_REGISTRY), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const keys = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!specifier.startsWith('@/') || !bindings || !ts.isNamedImports(bindings)) continue;
    const base = resolve(repositoryRoot, specifier.slice(2));
    const file = ['.ts', '.tsx'].map((extension) => `${base}${extension}`).find((path) => existsSync(path));
    if (file === undefined) continue;
    const modulePath = relative(repositoryRoot, file).replaceAll('\\', '/');
    for (const element of bindings.elements)
      keys.add(`${modulePath}#${(element.propertyName ?? element.name).text}`);
  }
  registry = keys;
  return keys;
}

export function isReadAction(module: string, imported: string): boolean {
  const key = `${module}#${imported}`;
  return registryReads().has(key) || key in REVIEWED_READS;
}

/** The reviewed reads that the registry now holds, or that name no exported function of a 'use server' module. */
export function staleReviewedReads(): string[] {
  return Object.keys(REVIEWED_READS).filter((key) => {
    const [module = '', name = ''] = key.split('#');
    const path = resolve(repositoryRoot, module);
    if (registryReads().has(key) || !existsSync(path)) return true;
    const text = readFileSync(path, 'utf8');
    return !/^['"]use server['"]/.test(text) || !new RegExp(`export async function ${name}\\b`).test(text);
  });
}
