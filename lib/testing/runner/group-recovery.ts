import type { TraceStages } from '../runs/replay-checkpoint';

/** Where a diagnostic ran: on the failed run's retained world, or on a world of its own. */
export type DiagnosticWorld = 'retained' | 'fresh';

type RecoveryRun = {
  runKey: string;
  sourceRunKey: string | null;
  lane?: string | undefined;
  groupId?: string | undefined;
  status: string;
  classification: string | null;
  cleanedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  target?: string | undefined;
  buildId?: string | null | undefined;
  /** Absent on manifests written before fresh-world diagnostics existed: those replayed the retained world. */
  diagnosticWorld?: DiagnosticWorld | undefined;
  selectedTestIds?: readonly string[] | undefined;
};

const time = (value: string | null): number => (value === null ? Number.NaN : Date.parse(value));

/**
 * A fresh-world diagnostic counts only when it ran every test of the failed run and was the first
 * fresh-world diagnostic of that run: a second one would turn the diagnosis into a retry until green.
 */
function qualifiesFresh(failed: RecoveryRun, diagnostic: RecoveryRun, runs: readonly RecoveryRun[]): boolean {
  const selected = new Set(diagnostic.selectedTestIds ?? []);
  const coversGroup =
    (failed.selectedTestIds ?? []).length > 0 &&
    (failed.selectedTestIds ?? []).every((id) => selected.has(id));
  const first = runs
    .filter((run) => run.sourceRunKey === failed.runKey && run.diagnosticWorld === 'fresh')
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))[0];
  return coversGroup && first?.runKey === diagnostic.runKey;
}

/**
 * One bounded retry follows actual diagnosis, not a free-text override.
 * The diagnostic must run on the same served build (the preflight refuses a server whose receipt
 * no longer matches the application inputs, so an equal build id proves the application unchanged)
 * and the same target; the retry check separately proves the group's own inputs unchanged.
 * A replay on the retained world must end before that world is cleaned. A test that wrote before
 * it failed leaves a world it cannot meet again, so for it the diagnosis is the first fresh-world
 * run of the whole failed group (`freshDiagnosisProblem` decides when one may start). Until
 * 2026-09-18 the comparison used the repository-wide candidate hash, which a harness edit outside
 * the group's inputs also changed, so a diagnostic run after such an edit silently stopped counting.
 */
export function recoveredEnvironmentRuns(runs: readonly RecoveryRun[]): string[] {
  return runs
    .filter((failed) => {
      if (
        failed.classification !== 'environment' ||
        !failed.cleanedAt ||
        !failed.completedAt ||
        !failed.buildId ||
        !failed.target
      )
        return false;
      const failedAt = time(failed.completedAt);
      return runs.some((diagnostic) => {
        const startedAt = time(diagnostic.startedAt);
        const completedAt = time(diagnostic.completedAt);
        if (
          diagnostic.sourceRunKey !== failed.runKey ||
          diagnostic.status !== 'diagnostic_passed' ||
          diagnostic.target !== failed.target ||
          diagnostic.buildId !== failed.buildId ||
          !(startedAt > failedAt) ||
          !(completedAt >= startedAt)
        )
          return false;
        if (diagnostic.diagnosticWorld === 'fresh') return qualifiesFresh(failed, diagnostic, runs);
        return completedAt <= time(failed.cleanedAt);
      });
    })
    .map((run) => run.runKey);
}

/**
 * Whether any failed test of the source run may have written to its world before it failed:
 * a test with no readable trace, or whose body started, may have; one that failed in its hooks
 * did not. A run that failed outside every test (setup, evidence) has no single test to replay.
 */
export function failedTestsWroteWorld(stages: readonly (TraceStages | null)[]): boolean {
  if (!stages.length) return true;
  return stages.some((stage) => stage === null || stage.bodyStarted || stage.completed.length > 0);
}

/**
 * Refuses a fresh-world diagnostic that could not qualify an environment retry: the source must be
 * a group run classified `environment`, on the build now served, not yet diagnosed on a fresh world,
 * and its failed tests must have written to their world (otherwise the retained replay stays the rule).
 */
export function freshDiagnosisProblem(input: {
  source: RecoveryRun;
  servedBuildId: string | null;
  runs: readonly RecoveryRun[];
  failedTestStages: readonly (TraceStages | null)[];
}): string | undefined {
  const { source } = input;
  const retainedReplay = `Replay it on the retained world instead: bun run test:diagnostic (test:diagnostic:audit for an audit group) --grep "<title>" --reuse-run ${source.runKey}`;
  if (source.lane !== 'group' || !source.groupId)
    return `${source.runKey} is no group run; a fresh-world diagnostic repeats a failed group.`;
  if (!['failed', 'failed_retained'].includes(source.status))
    return `${source.runKey} did not fail (status ${source.status}).`;
  if (source.classification !== 'environment')
    return `${source.runKey} is classified ${source.classification ?? 'not yet'}; only an environment failure has a diagnostic retry. Classify it first: bun run test:runs classify ${source.runKey} ...`;
  if (!source.buildId || source.buildId !== input.servedBuildId)
    return `${source.runKey} ran on build ${source.buildId ?? 'unknown'}, the served build is ${input.servedBuildId ?? 'unknown'}. Only a diagnostic on the same build can qualify the retry.`;
  const earlier = input.runs.find(
    (run) => run.sourceRunKey === source.runKey && run.diagnosticWorld === 'fresh',
  );
  if (earlier)
    return `${earlier.runKey} already diagnosed ${source.runKey} on a fresh world (${earlier.status}). A second fresh-world diagnostic is a retry until green.`;
  if (!failedTestsWroteWorld(input.failedTestStages))
    return `The failed test of ${source.runKey} failed before its body ran, so its retained world is the state it met. ${retainedReplay}`;
  return undefined;
}
