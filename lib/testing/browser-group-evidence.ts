import type { RunManifest } from "../../tests/golden/support/run-state";
import type { GroupResult } from "./group-evidence";
import type { PlaywrightTarget } from "./run-policy";

export type BrowserGroupRunEvidence = Pick<RunManifest,
  "runKey" | "groupId" | "groupFingerprint" | "target" | "lane" | "status" | "startedAt" | "completedAt" |
  "cleanedAt" | "retainedAt" | "buildId" | "total" | "passed" | "failed" | "skipped" | "failures"
>;

function completeCleanPass(run: BrowserGroupRunEvidence): boolean {
  return run.status === "passed" && run.lane === "group" &&
    run.completedAt !== null && Number.isFinite(Date.parse(run.completedAt)) &&
    run.cleanedAt !== null && Number.isFinite(Date.parse(run.cleanedAt)) &&
    run.total > 0 && run.passed === run.total && run.failed === 0 && run.skipped === 0 && run.failures.length === 0;
}

/** Direct runner failures must participate in default selection, even without a verifier report. */
export function unresolvedBrowserGroupIds(runs: readonly BrowserGroupRunEvidence[], target: PlaywrightTarget): string[] {
  const latest = new Map<string, BrowserGroupRunEvidence>();
  for (const run of [...runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
    if (run.target === target && run.groupId) latest.set(run.groupId, run);
  }
  return [...latest.values()].filter((run) => !completeCleanPass(run)).map((run) => run.groupId!);
}

/** Report copies cannot hide a later direct group failure or unfinished world. */
export function browserGroupReuseProblem(input: {
  result: GroupResult;
  target: PlaywrightTarget;
  runs: readonly BrowserGroupRunEvidence[];
}): string | undefined {
  if (input.result.status !== "passed" || !input.result.runKey || !input.result.buildId) {
    return "Browser reuse requires a passed result with its original run and build identity.";
  }
  const references = input.runs.filter((run) => run.runKey === input.result.runKey);
  const [reference] = references;
  if (references.length !== 1 || !reference) return "The referenced browser run is missing or ambiguous in the run registry.";
  if (reference.groupId !== input.result.groupId || reference.groupFingerprint !== input.result.fingerprint || reference.target !== input.target || reference.buildId !== input.result.buildId) {
    return "The referenced browser run has a different group inputs, target, or build identity.";
  }
  if (!completeCleanPass(reference)) return "The referenced browser run is not a complete, cleaned passing group run.";
  const referenceStarted = Date.parse(reference.startedAt);
  if (!Number.isFinite(referenceStarted)) return "The referenced browser run has no valid start time.";
  for (const run of input.runs) {
    if (run.runKey === reference.runKey || run.groupId !== reference.groupId || run.target !== input.target) continue;
    const started = Date.parse(run.startedAt);
    if (!Number.isFinite(started)) return `Run ${run.runKey} has an invalid start time; its order cannot qualify reuse.`;
    // Direct commands do not have a group-input fingerprint. A later failure
    // therefore invalidates this older proof conservatively, across candidates.
    if (started >= referenceStarted && !completeCleanPass(run)) {
      return `Later run ${run.runKey} did not complete as a cleaned pass. The older group result cannot qualify acceptance.`;
    }
  }
  return undefined;
}
