import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SURFACE_GROUPS, surfaceTests } from './surface-groups';

/**
 * The product files each layout sweep `audit:layout:<area>` renders, so a change plan selects
 * the sweeps a changed page, tab or dialog can break (decision 0007, amendment 2026-11-12). A
 * sweep's roots are the page and loading files of the routes it audits and the component of each
 * dialog it opens (dialog-inventory.ts); its files are what those roots import, followed through
 * app/, components/ and hooks/ only, since the data layer under lib/ draws nothing.
 */
const RENDERED = /^(?:app|components|hooks)\//;

/**
 * A file that more sweeps than this render is a shared control or shell, such as a button or the
 * page header: it selects no sweep in a change plan, and the nightly full run checks it. A root
 * always selects its own sweeps, however many share it.
 */
export const SHARED_SURFACE_LIMIT = 5;

/** The files of an audited route under app/(app)/: its page and, when it has one, its skeleton. */
function routeFiles(repositoryRoot: string, route: string): string[] {
  return ['page.tsx', 'loading.tsx']
    .map((name) => `app/(app)${route}/${name}`)
    .filter((file) => existsSync(join(repositoryRoot, file)));
}

/** Each sweep's roots: the files of the routes whose view or tabs it audits, and its dialogs' components. */
export function surfaceRoots(repositoryRoot: string): Map<string, string[]> {
  return new Map(
    SURFACE_GROUPS.map((group) => {
      const roots = new Set<string>();
      for (const piece of surfaceTests(group)) {
        if (piece.defaultView) for (const file of routeFiles(repositoryRoot, piece.route)) roots.add(file);
        for (const dialog of piece.dialogs) roots.add(dialog.key.slice(0, dialog.key.indexOf('#')));
      }
      return [`audit:layout:${group}`, [...roots].sort()];
    }),
  );
}

/**
 * The files each sweep renders, without the shared ones: a changed file in a sweep's list selects
 * that sweep. `graph` is the repository's import graph (group-evidence.ts `sourceImportGraph`).
 */
export function renderedSurfaceFiles(
  graph: ReadonlyMap<string, readonly string[]>,
  roots: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
  const closures = new Map(
    [...roots].map(([group, files]) => {
      const reached = new Set<string>();
      const pending = [...files];
      while (pending.length) {
        const file = pending.pop();
        if (file === undefined || reached.has(file) || !RENDERED.test(file)) continue;
        reached.add(file);
        pending.push(...(graph.get(file) ?? []));
      }
      return [group, reached] as const;
    }),
  );
  const sweepsOf = new Map<string, number>();
  for (const reached of closures.values())
    for (const file of reached) sweepsOf.set(file, (sweepsOf.get(file) ?? 0) + 1);
  return new Map(
    [...closures].map(([group, reached]) => {
      const own = new Set(roots.get(group));
      return [
        group,
        [...reached]
          .filter((file) => own.has(file) || (sweepsOf.get(file) ?? 0) <= SHARED_SURFACE_LIMIT)
          .sort(),
      ];
    }),
  );
}
