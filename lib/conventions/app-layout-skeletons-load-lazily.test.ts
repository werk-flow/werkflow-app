// Rule test: the shared (app) layout's start-up carries no route's loading skeleton. Every role's
// cold start loads the layout's code, so a skeleton it imports statically brings its area's
// content modules to every person, and the bundler re-packs the layout's chunks whenever an
// area's routes change (werk-flow/werkflow-app#485: two office routes added a field cold-start
// request). The organization-switch overlay reaches each area's skeleton through `import()`.
// The registries in components/ui/ and components/shared/ are the shell's own parts and stay.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { resolveSpecifier } from './action-prechecks-scan';
import { moduleSpecifierOf, repositorySources, resolveModuleFile, type SourceHost } from './module-imports';
import { listProductSources, parseProductSource } from './product-sources';

const APP_LAYOUT = 'app/(app)/layout.tsx';
const SHELL_PARTS = ['components/ui/', 'components/shared/'];

/** The product module a specifier names, with or without its file extension. */
function resolveTarget(importer: string, specifier: string, host: SourceHost): string | null {
  const exact = resolveSpecifier(importer, specifier);
  if (exact !== null && /\.tsx?$/.test(exact) && host(exact) !== null) return exact;
  return resolveModuleFile(importer, specifier, host);
}

/** The product modules a module imports or re-exports statically; type-only imports leave no code. */
function staticImports(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null) return [];
  return parseProductSource(file, text).statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) return [];
    if (ts.isExportDeclaration(statement) && statement.isTypeOnly) return [];
    const specifier = moduleSpecifierOf(statement);
    const target = specifier === null ? null : resolveTarget(file, specifier, host);
    return target === null ? [] : [target];
  });
}

/** The modules a route's `loading.tsx` imports, apart from the shell's shared parts. */
function routeSkeletonModules(loadingFiles: readonly string[], host: SourceHost): Set<string> {
  return new Set(
    loadingFiles
      .flatMap((file) => staticImports(file, host))
      .filter((target) => !SHELL_PARTS.some((part) => target.startsWith(part))),
  );
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
    'app/(app)/static-layout.tsx': [
      "import { Skeleton } from '@/components/ui/skeleton';",
      "import { AreaSkeleton } from '@/components/shell-static';",
    ].join('\n'),
    'app/(app)/lazy-layout.tsx': [
      "import { PageShell } from '@/components/shared/page-shell';",
      "import { load } from '@/components/shell-lazy';",
      "import '@/components/shell-type';",
    ].join('\n'),
  };
  const host: SourceHost = (file) => files[file] ?? null;

  test('probes: a skeleton re-exported through the shell is reported; lazy, type-only and shared parts are not', () => {
    const loading = ['app/(app)/area/loading.tsx'];
    expect(staticallyReachedSkeletons('app/(app)/static-layout.tsx', loading, host)).toEqual([
      'components/shell-static.tsx -> components/loading-states/area-skeleton.tsx',
    ]);
    expect(staticallyReachedSkeletons('app/(app)/lazy-layout.tsx', loading, host)).toEqual([]);
  });
});
