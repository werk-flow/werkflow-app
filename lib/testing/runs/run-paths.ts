import { resolve } from 'node:path';

export type BrowserRunPaths = {
  directory: string;
  activeState: string;
  archivedState: string;
  results: string;
  report: string;
};

/** Resolve every mutable browser file through its owning run, never a suite-wide directory. */
export function browserRunPaths(repositoryRoot: string, runKey: string): BrowserRunPaths {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runKey) || runKey.includes('..')) {
    throw new Error(`Invalid run key: ${runKey}`);
  }
  const archiveRoot = resolve(repositoryRoot, '.agent-logs/playwright-runs');
  const directory = resolve(archiveRoot, runKey);
  if (resolve(directory, '..') !== archiveRoot) throw new Error(`Invalid run key: ${runKey}`);
  return {
    directory,
    activeState: resolve(directory, 'active'),
    archivedState: resolve(directory, 'state'),
    results: resolve(directory, 'playwright/results'),
    report: resolve(directory, 'playwright/report'),
  };
}

/** Commands such as historical recovery supply an explicit owner instead of inheriting a current run. */
export function configuredRunKey(): string {
  const runKey = process.env.WERKFLOW_RUN_KEY;
  if (!runKey) throw new Error('WERKFLOW_RUN_KEY was not configured.');
  return runKey;
}

/** The absent marker identifies historical manifests. Unknown layouts must never read shared state. */
export function manifestActiveStateDirectory(
  repositoryRoot: string,
  manifest: { runKey: string; artifactLayout?: string },
): string {
  const paths = browserRunPaths(repositoryRoot, manifest.runKey);
  if (manifest.artifactLayout === 'run-owned-v1') return paths.activeState;
  if (manifest.artifactLayout === undefined) return resolve(repositoryRoot, 'tests/golden/.artifacts');
  throw new Error(`Unsupported browser artifact layout: ${manifest.artifactLayout}`);
}
