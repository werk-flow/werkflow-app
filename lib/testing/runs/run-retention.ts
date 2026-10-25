import { existsSync, readdirSync, readFileSync, rmSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { errorCode } from '../runner/error-code';
import { z } from 'zod';
import { listRunManifests, runDirectory, updateRunManifest } from '../../../tests/golden/support/run-state';
import { readPerformanceBaselines } from '../performance-baselines';

const REPOSITORY_ROOT = join(__dirname, '../../..');

/**
 * Retention for `.agent-logs/playwright-runs`. The archive reached 25 GB on
 * 2026-09-14 and 54 GB on 2026-10-23, because pruning ran only on demand and
 * kept every failed run. Every `test:verify` run now prunes after its report.
 * Pruning removes only the two directories that hold traces, reports and the
 * active copy of a world (`playwright/`, `active/`); the manifest, the runner
 * log, the latency and workload archives and the archived `state/` stay, so a
 * pruned run still qualifies reuse, calibration and cleanup.
 */
const PRUNABLE_RUN_DIRECTORIES = ['playwright', 'active'] as const;
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
  classification: string | null;
  sourceRunKey: string | null;
  prunedAt?: string | null;
};

const citedReportSchema = z.object({
  target: z.string(),
  results: z.array(
    z.object({
      groupId: z.string(),
      status: z.string(),
      startedAt: z.string(),
      runKey: z.string().nullable(),
    }),
  ),
});
type CitedReport = z.infer<typeof citedReportSchema>;

/** The group results of every report in the verification archive. */
function readVerificationReports(verificationRoot: string): CitedReport[] {
  if (!existsSync(verificationRoot)) return [];
  return readdirSync(verificationRoot).flatMap((directory) => {
    const file = join(verificationRoot, directory, 'report.json');
    return existsSync(file) ? [citedReportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))] : [];
  });
}

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

/** A failed run keeps its traces until its diagnosis is recorded (`bun run test:runs classify`). */
const FAILURE_STATUSES = ['failed', 'failed_retained', 'interrupted', 'timedout'];

function failureClassified(run: RetentionRun, classifiedRunKeys: ReadonlySet<string>): boolean {
  if (run.status === 'passed') return true;
  if (FAILURE_STATUSES.includes(run.status)) return run.classification !== null;
  // A passing diagnostic replays a failure; its traces serve that failure's classification.
  if (run.status === 'diagnostic_passed')
    return run.sourceRunKey !== null && classifiedRunKeys.has(run.sourceRunKey);
  return false;
}

/** Completed, classified when it failed, cleaned or world-less, uncited, older than a day, not yet pruned. */
export function prunableRunKeys(input: {
  runs: readonly RetentionRun[];
  cited: ReadonlySet<string>;
  now: number;
}): string[] {
  const classifiedRunKeys = new Set(
    input.runs.filter((run) => run.classification !== null).map((run) => run.runKey),
  );
  return input.runs
    .filter((run) => {
      if (run.prunedAt || !run.completedAt) return false;
      if (!failureClassified(run, classifiedRunKeys)) return false;
      if (run.world && !run.cleanedAt) return false;
      if (input.cited.has(run.runKey)) return false;
      const started = Date.parse(run.startedAt);
      return Number.isFinite(started) && input.now - started >= PRUNE_MINIMUM_AGE_MS;
    })
    .map((run) => run.runKey);
}

/**
 * Plans retention over the whole archive and, with `prune`, removes the planned
 * runs' traces, reports and active state and stamps `prunedAt` in each manifest.
 * The caller holds the workspace test lock. Returns the line to log.
 */
export function pruneRunArchive(mode: 'plan' | 'prune'): string {
  const cited = citedRunKeys({
    reports: readVerificationReports(join(REPOSITORY_ROOT, '.agent-logs', 'verification')),
    baselineRunKeys: readPerformanceBaselines().baselines.flatMap((baseline) => baseline.source.runKeys),
  });
  const runKeys = prunableRunKeys({ runs: listRunManifests(), cited, now: Date.now() });
  const bytes = prunableArchiveBytes(join(REPOSITORY_ROOT, '.agent-logs', 'playwright-runs'), runKeys);
  const size = `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (mode === 'plan')
    return `${runKeys.length} runs hold ${size} of prunable traces, reports and active state; ${cited.size} cited runs, every unclassified failure and every retained or unfinished run are kept.`;
  const prunedAt = new Date().toISOString();
  for (const runKey of runKeys) {
    for (const name of PRUNABLE_RUN_DIRECTORIES)
      rmSync(join(runDirectory(runKey), name), { recursive: true, force: true });
    updateRunManifest(runKey, { prunedAt });
  }
  return `Pruned ${runKeys.length} runs and freed ${size} of traces, reports and active state; manifests, logs, latency and workload archives and archived state stay.`;
}

/**
 * A live run's `active/` directory holds atomic-write temp files for a few
 * milliseconds. With several workers the next runner's size scan can list one and
 * find it renamed away at stat time (release run of 2026-09-18, the
 * list-pagination runner crashed on the layout run's manifest temp file). A
 * vanished entry weighs nothing; every other error still propagates.
 */
export function fileSizeOrZero(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 0;
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

/** Weighs only the named runs: a scan of the whole archive is too slow for the end of every run. */
export function prunableArchiveBytes(archiveRoot: string, runKeys: readonly string[]): number {
  return runKeys.reduce(
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
