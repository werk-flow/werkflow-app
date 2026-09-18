type RecoveryRun = {
  runKey: string;
  sourceRunKey: string | null;
  status: string;
  classification: string | null;
  cleanedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  target?: string | undefined;
  buildId?: string | null | undefined;
};

/**
 * One bounded retry follows actual retained diagnosis, not a free-text override.
 * The diagnostic must replay the failed stage on the same served build (the
 * preflight refuses a server whose receipt no longer matches the application
 * inputs, so an equal build id proves the application unchanged) and the same
 * target; the retry check separately proves the group's own inputs unchanged.
 * Until 2026-09-18 the comparison used the repository-wide candidate hash,
 * which a harness edit outside the group's inputs also changed, so a diagnostic
 * run after such an edit silently stopped counting (release run of 2026-09-18).
 */
export function recoveredEnvironmentRuns(runs: readonly RecoveryRun[]): string[] {
  return runs.filter((failed) => failed.classification === "environment" && failed.cleanedAt && failed.completedAt && failed.buildId && failed.target &&
    runs.some((diagnostic) => diagnostic.sourceRunKey === failed.runKey && diagnostic.status === "diagnostic_passed" && diagnostic.target === failed.target && diagnostic.buildId === failed.buildId && diagnostic.startedAt > failed.completedAt!)
  ).map((run) => run.runKey);
}
