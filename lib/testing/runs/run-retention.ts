import { existsSync, readdirSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Retention for `.agent-logs/playwright-runs` (pre-Wave-3 step 1). The archive
 * reached 25 GB on 2026-09-14 because nothing ever deleted Playwright traces.
 * Pruning removes only the two directories that hold traces, reports and the
 * active copy of a world (`playwright/`, `active/`); the manifest, the runner
 * log, the latency and workload archives and the archived `state/` stay, so a
 * pruned run still qualifies reuse, calibration and cleanup.
 */
export const PRUNABLE_RUN_DIRECTORIES = ['playwright', 'active'] as const;
/** Reserve space for traces and reports; historical archive size is not a run prerequisite. */
const MINIMUM_FREE_BYTES = 2 * 1024 ** 3;
const PRUNE_MINIMUM_AGE_MS = 24 * 60 * 60 * 1000;

export type RetentionRun = {
  runKey: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  retainedAt: string | null;
  cleanedAt: string | null;
  world: { runId: string } | null;
  prunedAt?: string | null;
};

type CitedReport = {
  target: string;
  results: readonly { groupId: string; status: string; startedAt: string; runKey: string | null }[];
};

/** The runs whose artifacts a current proof or a reviewed reference still points at. */
export function citedRunKeys(input: {
  reports: readonly CitedReport[];
  baselineRunKeys: readonly string[];
}): Set<string> {
  const latest = new Map<string, { startedAt: string; status: string; runKey: string | null }>();
  for (const report of input.reports) {
    for (const result of report.results) {
      const key = `${report.target}:${result.groupId}`;
      const known = latest.get(key);
      if (!known || result.startedAt > known.startedAt) latest.set(key, result);
    }
  }
  const cited = new Set(input.baselineRunKeys);
  for (const result of latest.values())
    if (result.status === 'passed' && result.runKey) cited.add(result.runKey);
  return cited;
}

/** Completed, cleaned or world-less, uncited, older than a day, not yet pruned. */
export function prunableRunKeys(input: {
  runs: readonly RetentionRun[];
  cited: ReadonlySet<string>;
  now: number;
}): string[] {
  return input.runs
    .filter((run) => {
      if (run.prunedAt || !run.completedAt) return false;
      if (!['passed', 'failed', 'diagnostic_passed', 'timedout'].includes(run.status)) return false;
      if (run.world && !run.cleanedAt) return false;
      if (input.cited.has(run.runKey)) return false;
      const started = Date.parse(run.startedAt);
      return Number.isFinite(started) && input.now - started >= PRUNE_MINIMUM_AGE_MS;
    })
    .map((run) => run.runKey);
}

/**
 * A live run's `active/` directory holds atomic-write temp files for a few
 * milliseconds. With several workers the next runner's size scan can list one and
 * find it renamed away at stat time (release run of 2026-09-18, the
 * list-pagination runner crashed on the layout run's manifest temp file), or
 * still locked by the rename on Windows. A vanished or transiently locked
 * entry weighs nothing; every other error still propagates.
 */
const TRANSIENT_STAT_ERRORS = new Set(['ENOENT', 'EPERM', 'EBUSY']);
export function fileSizeOrZero(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if (TRANSIENT_STAT_ERRORS.has((error as NodeJS.ErrnoException).code ?? '')) return 0;
    throw error;
  }
}

function directorySize(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) total += directorySize(child);
    else if (entry.isFile()) total += fileSizeOrZero(child);
  }
  return total;
}

/** Explicit pruning only: recursive archive inspection can be expensive on large checkouts. */
export function prunableArchiveBytes(archiveRoot: string, runKeys?: readonly string[]): number {
  if (!existsSync(archiveRoot)) return 0;
  const keys =
    runKeys ??
    readdirSync(archiveRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  return keys.reduce(
    (total, runKey) =>
      total +
      PRUNABLE_RUN_DIRECTORIES.reduce((sum, name) => sum + directorySize(join(archiveRoot, runKey, name)), 0),
    0,
  );
}

export function availableStorageProblem(
  availableBytes: number,
  reserve = MINIMUM_FREE_BYTES,
): string | undefined {
  if (availableBytes >= reserve) return undefined;
  return `Only ${(availableBytes / 1024 ** 3).toFixed(1)} GB is available for browser evidence; keep at least ${(reserve / 1024 ** 3).toFixed(0)} GB free. Free disk space or inspect bun run test:runs prune. Retained or cited evidence must stay protected.`;
}

/** A volume query replaces recursive archive traversal on the normal execution path. */
export function browserStorageProblem(repositoryRoot: string): string | undefined {
  const volume = statfsSync(repositoryRoot);
  return availableStorageProblem(volume.bavail * volume.bsize);
}
