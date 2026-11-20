// Rule test: the shared (app) layout's start-up carries no route's loading skeleton. Every role's
// cold start loads the layout's code, so a skeleton it imports statically brings its area's
// content modules to every person, and the bundler re-packs the layout's chunks whenever an
// area's routes change (werk-flow/werkflow-app#485: two office routes added a field cold-start
// request). The organization-switch overlay reaches each area's skeleton through `import()`.
// The registries in components/ui/ and components/shared/ are the shell's own parts and stay.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  moduleSpecifierOf,
  repositorySources,
  resolveProductModule,
  type SourceHost,
} from './module-imports';
import { listProductSources, parseProductSource } from './product-sources';

const APP_LAYOUT = 'app/(app)/layout.tsx';
const SHELL_PARTS = ['components/ui/', 'components/shared/'];

/**
 * Whether a declaration brings no code: `import type`, `export type`, or named bindings that are
 * all inline `type` ones. A side-effect import (`import './x'`) has no clause and loads code.
 */
function typeOnly(statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return (
      clause.name === undefined &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    );
  }
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return true;
    const clause = statement.exportClause;
    return (
      clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) => element.isTypeOnly)
    );
  }
  return false;
}

/** The product modules a module imports or re-exports statically; type-only imports leave no code. */
function staticImports(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null) return [];
  return parseProductSource(file, text).statements.flatMap((statement) => {
    if (typeOnly(statement)) return [];
    const specifier = moduleSpecifierOf(statement);
    const target = specifier === null ? null : resolveProductModule(file, specifier, host);
    return target === null ? [] : [target];
  });
}

/** The product modules a module re-exports with code; a barrel's skeletons count as its own. */
function reExports(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null) return [];
  return parseProductSource(file, text).statements.flatMap((statement) => {
    if (!ts.isExportDeclaration(statement) || typeOnly(statement)) return [];
    const specifier = moduleSpecifierOf(statement);
    const target = specifier === null ? null : resolveProductModule(file, specifier, host);
    return target === null ? [] : [target];
  });
}

const outsideShell = (file: string): boolean => !SHELL_PARTS.some((part) => file.startsWith(part));

/**
 * The route skeleton modules: each `loading.tsx` itself, which can draw its skeleton inline, the
 * modules it imports apart from the shell's shared parts, and whatever those re-export, so a
 * skeleton imported through a barrel is found where it lives.
 */
function routeSkeletonModules(loadingFiles: readonly string[], host: SourceHost): Set<string> {
  const modules = new Set<string>(loadingFiles);
  const queue = loadingFiles.flatMap((file) => staticImports(file, host)).filter(outsideShell);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    if (modules.has(next)) continue;
    modules.add(next);
    queue.push(...reExports(next, host).filter(outsideShell));
  }
  return modules;
}

/** Each route skeleton the layout reaches through static imports, as importer and skeleton. */
function staticallyReachedSkeletons(
  layout: string,
  loadingFiles: readonly string[],
  host: SourceHost,
): string[] {
  const skeletons = routeSkeletonModules(loadingFiles, host);
  const seen = new Set<string>([layout]);
  const queue = [layout];
  const found: string[] = [];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    for (const target of staticImports(file, host)) {
      if (skeletons.has(target)) found.push(`${file} -> ${target}`);
      if (!seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return found;
}

describe('the (app) layout loads route skeletons lazily', () => {
  test("the layout's static imports reach no route's loading skeleton", () => {
    const loadingFiles = listProductSources(['app']).filter((file) =>
      /^app\/\(app\)\/(.+\/)?loading\.tsx$/.test(file),
    );
    expect(loadingFiles.length).toBeGreaterThan(0);
    expect(staticallyReachedSkeletons(APP_LAYOUT, loadingFiles, repositorySources)).toEqual([]);
  });

  const files: Record<string, string> = {
    'app/(app)/area/loading.tsx': [
      "import { AreaSkeleton } from '@/components/loading-states/area-skeleton';",
      "import { Skeleton } from '@/components/ui/skeleton';",
      "import { PageShell } from '@/components/shared/page-shell';",
    ].join('\n'),
    'components/loading-states/area-skeleton.tsx': 'export function AreaSkeleton() {}',
    'components/ui/skeleton.tsx': 'export function Skeleton() {}',
    'components/shared/page-shell.tsx': 'export function PageShell() {}',
    'components/shell-static.tsx': "export { AreaSkeleton } from './loading-states/area-skeleton';",
    'components/shell-lazy.tsx':
      "export const load = () => import('@/components/loading-states/area-skeleton');",
    'components/shell-type.tsx':
      "import type { AreaSkeleton } from '@/components/loading-states/area-skeleton';",
    'components/shell-inline-type.tsx': [
      "import { type AreaSkeleton } from '@/components/loading-states/area-skeleton';",
      "export { type AreaSkeleton as Shape } from '@/components/loading-states/area-skeleton';",
    ].join('\n'),
    'app/(app)/barrel/loading.tsx': "import { BarrelSkeleton } from '@/components/loading-states';",
    'components/loading-states/index.ts': "export { BarrelSkeleton } from './barrel-skeleton';",
    'components/loading-states/barrel-skeleton.tsx': 'export function BarrelSkeleton() {}',
    'app/(app)/barrel-layout.tsx':
      "import { BarrelSkeleton } from '@/components/loading-states/barrel-skeleton';",
    'app/(app)/inline-layout.tsx': "import Loading from './area/loading';",
    'app/(app)/static-layout.tsx': [
      "import { Skeleton } from '@/components/ui/skeleton';",
      "import { AreaSkeleton } from '@/components/shell-static';",
    ].join('\n'),
    'app/(app)/lazy-layout.tsx': [
      "import { PageShell } from '@/components/shared/page-shell';",
      "import { load } from '@/components/shell-lazy';",
      "import '@/components/shell-type';",
      "import '@/components/shell-inline-type';",
    ].join('\n'),
  };
  const host: SourceHost = (file) => files[file] ?? null;

  test('probes: a skeleton re-exported through the shell is reported; lazy, type-only (inline too) and shared parts are not', () => {
    const loading = ['app/(app)/area/loading.tsx'];
    expect(staticallyReachedSkeletons('app/(app)/static-layout.tsx', loading, host)).toEqual([
      'components/shell-static.tsx -> components/loading-states/area-skeleton.tsx',
    ]);
    expect(staticallyReachedSkeletons('app/(app)/lazy-layout.tsx', loading, host)).toEqual([]);
  });

  test('probes: a loading.tsx itself, and a skeleton its barrel re-exports, are route skeletons', () => {
    expect(
      staticallyReachedSkeletons('app/(app)/inline-layout.tsx', ['app/(app)/area/loading.tsx'], host),
    ).toEqual([
      'app/(app)/inline-layout.tsx -> app/(app)/area/loading.tsx',
      'app/(app)/area/loading.tsx -> components/loading-states/area-skeleton.tsx',
    ]);
    expect(
      staticallyReachedSkeletons('app/(app)/barrel-layout.tsx', ['app/(app)/barrel/loading.tsx'], host),
    ).toEqual(['app/(app)/barrel-layout.tsx -> components/loading-states/barrel-skeleton.tsx']);
  });
});
