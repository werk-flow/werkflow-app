import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';

// The client code and Server Action imports that the feedback conventions
// read: lib/conventions/server-action-first-frame.test.ts (every write shows
// feedback in its first frame) and lib/conventions/server-action-feedback.test.ts
// (pending state of a write has one owner).
//
// Client code: a module with the 'use client' directive, and every product
// module without a directive that client code imports. Server components,
// route handlers and 'use server' modules are not client code.

/** Hooks that show pending, busy or optimistic state before they await the work they are given. */
export const FEEDBACK_OWNER_HOOKS: Readonly<Record<string, string>> = {
  useServerAction: 'counts the call as pending before it awaits the wrapped action',
  usePendingTask: 'useServerAction over an arbitrary task',
  useBusyIds: 'marks the id busy before it awaits the task',
  useBatchProgress: 'adds the progress rows before the first worker runs',
  useOptimisticRun: 'applies the calendar change and the progress banner before execute',
  useCalendarMutations: 'returns the calendar useOptimisticRun runner',
  useOptimisticList: 'insert, update and remove show the change before the caller awaits',
  useTimeAccountForm: 'binds the form submit to useServerAction',
};

/** A setter of a pending flag, called with `true`: `setIsSaving`, `setIsBatchWorking`. */
export const PENDING_FLAG_SETTER = /^set\w*(Pending|Busy|ing)\w*$/;

/** A setter of the pending subject, called with a value: `setEndingId(id)`, `setPendingAction(kind)`. */
export const PENDING_SUBJECT_SETTER = /^set\w*(Pending|Busy|ing)\w*(Id|Ids|Key|Action|State|Draft)$/;

const MODULE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveModule(importer: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(repositoryRoot, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(repositoryRoot, dirname(importer), specifier)
      : null;
  if (base === null) return null;
  const found = MODULE_EXTENSIONS.map((extension) => `${base}${extension}`).find((path) => existsSync(path));
  return found === undefined ? null : relative(repositoryRoot, found).replaceAll('\\', '/');
}

/** Parsed sources by file; a scan's probes plant fixture modules here. */
export const parsedSources = new Map<string, ts.SourceFile>();

export function sourceOf(file: string): ts.SourceFile {
  const cached = parsedSources.get(file);
  if (cached) return cached;
  const source = parseProductSource(file);
  parsedSources.set(file, source);
  return source;
}

function directive(source: ts.SourceFile): string | null {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return null;
    const text = statement.expression.text;
    if (text === 'use client' || text === 'use server') return text;
  }
  return null;
}

export type ModuleImport = { local: string; imported: string; module: string };

/** The file's imports of product modules; type-only imports only when `withTypes`. */
export function moduleImports(file: string, withTypes = false): ModuleImport[] {
  const imports: ModuleImport[] = [];
  for (const statement of sourceOf(file).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || (clause.isTypeOnly && !withTypes)) continue;
    const resolved = resolveModule(file, statement.moduleSpecifier.text);
    if (resolved === null) continue;
    if (clause.name) imports.push({ local: clause.name.text, imported: 'default', module: resolved });
    const bindings = clause.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.isTypeOnly && !withTypes) continue;
      imports.push({
        local: element.name.text,
        imported: (element.propertyName ?? element.name).text,
        module: resolved,
      });
    }
  }
  return imports;
}

/** 'use client' modules and the directive-free product modules they reach. */
export function findClientModules(): string[] {
  const sources = new Set(listProductSources());
  const queue = [...sources].filter((file) => directive(sourceOf(file)) === 'use client');
  const client = new Set(queue);
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const { module } of moduleImports(file)) {
      if (client.has(module) || !sources.has(module) || directive(sourceOf(module)) !== null) continue;
      client.add(module);
      queue.push(module);
    }
  }
  return [...client].sort();
}

export function isCallee(node: ts.Node): boolean {
  return ts.isCallExpression(node.parent) && node.parent.expression === node;
}

export function isImmediatelyInvoked(fn: ts.Node): boolean {
  let current = fn;
  while (ts.isParenthesizedExpression(current.parent)) current = current.parent;
  return isCallee(current);
}

/** The file's imports of Server Actions by local name. */
export function actionImports(file: string): Map<string, ModuleImport> {
  return new Map(
    moduleImports(file)
      .filter(({ module }) => directive(sourceOf(module)) === 'use server')
      .map((entry) => [entry.local, entry]),
  );
}
