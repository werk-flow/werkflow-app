// Rule test: offline code that runs only sometimes loads lazily. The field cold start's script
// bytes have almost no margin, and a static import puts a module into a startup chunk of every
// page that imports it. Product code reaches an offline module only through `import()`; offline
// modules may import each other, since they load together. The registration and the shell refill
// every cold start needs stay in the app shell: a chunk loaded after the load event still costs
// the lab's cold start a request and its bytes.
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import { moduleSpecifierOf, repositorySources, resolveModuleFile, type SourceHost } from './module-imports';
import { listProductSources, parseProductSource } from './product-sources';

/** The offline modules: the cache clear, later the offline data, and the iOS install hint. */
function isOfflineModule(file: string): boolean {
  return file.startsWith('lib/offline/') || file === 'components/shared/ios-install-hint.tsx';
}

/** The offline modules a product module imports statically; type-only imports leave no code. */
function staticOfflineImports(file: string, host: SourceHost): string[] {
  const text = host(file);
  if (text === null || isOfflineModule(file)) return [];
  return parseProductSource(file, text)
    .statements.filter(
      (statement) =>
        !(ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) &&
        !(ts.isExportDeclaration(statement) && statement.isTypeOnly),
    )
    .flatMap((statement) => {
      const specifier = moduleSpecifierOf(statement);
      const target = specifier === null ? null : resolveModuleFile(file, specifier, host);
      return target !== null && isOfflineModule(target) ? [`${file} -> ${target}`] : [];
    });
}

describe('offline code loads lazily', () => {
  test('no product module outside the offline modules imports one statically', () => {
    expect(listProductSources().flatMap((file) => staticOfflineImports(file, repositorySources))).toEqual([]);
  });

  test('probes: a static import is reported; import(), a type-only import and an offline importer are not', () => {
    const files: Record<string, string> = {
      'lib/offline/service-worker-caches.ts': 'export async function clearServiceWorkerCaches() {}',
      'components/probe-static.ts':
        "import { clearServiceWorkerCaches } from '@/lib/offline/service-worker-caches';",
      'components/probe-lazy.ts': "export const load = () => import('@/lib/offline/service-worker-caches');",
      'components/probe-type.ts': "import type { X } from '@/lib/offline/service-worker-caches';",
      'lib/offline/outbox.ts':
        "import { clearServiceWorkerCaches } from '@/lib/offline/service-worker-caches';",
    };
    const host: SourceHost = (file) => files[file] ?? null;
    expect(staticOfflineImports('components/probe-static.ts', host)).toEqual([
      'components/probe-static.ts -> lib/offline/service-worker-caches.ts',
    ]);
    for (const file of ['components/probe-lazy.ts', 'components/probe-type.ts', 'lib/offline/outbox.ts'])
      expect(staticOfflineImports(file, host), file).toEqual([]);
  });
});
