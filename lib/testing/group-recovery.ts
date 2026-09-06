type RecoveryRun = {
  runKey: string;
  sourceRunKey: string | null;
  status: string;
  classification: string | null;
  cleanedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  target?: string;
  candidateFingerprint?: string;
};

/** One bounded retry follows actual retained diagnosis, not a free-text override. */
export function recoveredEnvironmentRuns(runs: readonly RecoveryRun[]): string[] {
  return runs.filter((failed) => failed.classification === "environment" && failed.cleanedAt && failed.completedAt &&
    runs.some((diagnostic) => diagnostic.sourceRunKey === failed.runKey && diagnostic.status === "diagnostic_passed" && diagnostic.target === failed.target && diagnostic.candidateFingerprint === failed.candidateFingerprint && diagnostic.startedAt > failed.completedAt!)
  ).map((run) => run.runKey);
}
