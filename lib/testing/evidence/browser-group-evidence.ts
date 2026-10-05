import type { RunManifest } from '../../../tests/golden/support/run-state';
import type { GroupResult } from './group-evidence';
import type { PlaywrightTarget } from '../runner/run-policy';
import { BROWSER_INPUT_DRIFT_MESSAGE } from './test-evidence';

export type BrowserGroupRunEvidence = Pick<
  RunManifest,
  | 'runKey'
  | 'groupId'
  | 'groupFingerprint'
  | 'target'
  | 'lane'
  | 'status'
  | 'startedAt'
  | 'completedAt'
  | 'cleanedAt'
  | 'retainedAt'
  | 'buildId'
  | 'total'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'failures'
>;

function completeCleanPass(run: BrowserGroupRunEvidence): boolean {
  return (
    run.status === 'passed' &&
    run.lane === 'group' &&
    run.completedAt !== null &&
    Number.isFinite(Date.parse(run.completedAt)) &&
    run.cleanedAt !== null &&
    Number.isFinite(Date.parse(run.cleanedAt)) &&
    run.total > 0 &&
    run.passed === run.total &&
    run.failed === 0 &&
    run.skipped === 0 &&
    run.failures.length === 0
  );
}

/** Direct runner failures must participate in default selection, even without a verifier report. */
export function unresolvedBrowserGroupIds(
  runs: readonly BrowserGroupRunEvidence[],
  target: PlaywrightTarget,
): string[] {
  const latest = new Map<string, BrowserGroupRunEvidence>();
  for (const run of [...runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
    if (run.target === target && run.groupId) latest.set(run.groupId, run);
  }
  return [...latest].filter(([, run]) => !completeCleanPass(run)).map(([groupId]) => groupId);
}

/** Report copies cannot hide a later direct group failure or unfinished world. */
export function browserGroupReuseProblem(input: {
  result: GroupResult;
  target: PlaywrightTarget;
  runs: readonly BrowserGroupRunEvidence[];
}): string | undefined {
  if (input.result.status !== 'passed' || !input.result.runKey || !input.result.buildId) {
    return 'Browser reuse requires a passed result with its original run and build identity.';
  }
  const references = input.runs.filter((run) => run.runKey === input.result.runKey);
  const [reference] = references;
  if (references.length !== 1 || !reference)
    return 'The referenced browser run is missing or ambiguous in the run registry.';
  if (
    reference.groupId !== input.result.groupId ||
    reference.groupFingerprint !== input.result.fingerprint ||
    reference.target !== input.target ||
    reference.buildId !== input.result.buildId
  ) {
    return 'The referenced browser run has a different group inputs, target, or build identity.';
  }
  if (!completeCleanPass(reference))
    return 'The referenced browser run is not a complete, cleaned passing group run.';
  const referenceStarted = Date.parse(reference.startedAt);
  if (!Number.isFinite(referenceStarted)) return 'The referenced browser run has no valid start time.';
  for (const run of input.runs) {
    if (run.runKey === reference.runKey || run.groupId !== reference.groupId || run.target !== input.target)
      continue;
    const started = Date.parse(run.startedAt);
    if (!Number.isFinite(started))
      return `Run ${run.runKey} has an invalid start time; its order cannot qualify reuse.`;
    // Direct commands do not have a group-input fingerprint. A later failure
    // therefore invalidates this older proof conservatively, across candidates.
    if (started >= referenceStarted && !completeCleanPass(run)) {
      return `Later run ${run.runKey} did not complete as a cleaned pass. The older group result cannot qualify acceptance.`;
    }
  }
  return undefined;
}

type ClassifiedGroupRun = BrowserGroupRunEvidence & Pick<RunManifest, 'classification'>;

/** A run voided by input drift or interrupted before any test failed observed nothing to classify. */
function needsClassification(run: ClassifiedGroupRun): boolean {
  if (run.status === 'passed' || run.status === 'starting' || run.status === 'running') return false;
  if (run.failures.some((failure) => failure.message === BROWSER_INPUT_DRIFT_MESSAGE)) return false;
  if (run.status === 'interrupted' && run.failed === 0) return false;
  return run.classification === null;
}

/**
 * `test:verify` refuses to start while the latest failed browser run of a
 * group it would run is unclassified: an undiagnosed failure would otherwise
 * disappear behind the next attempt and from the campaign's failure classes.
 */
export function unclassifiedFailureProblem(input: {
  groupIds: readonly string[];
  target: PlaywrightTarget;
  runs: readonly ClassifiedGroupRun[];
}): string | undefined {
  const latest = new Map<string, ClassifiedGroupRun>();
  for (const run of [...input.runs].sort((left, right) => left.startedAt.localeCompare(right.startedAt))) {
    if (run.target === input.target && run.groupId && input.groupIds.includes(run.groupId))
      latest.set(run.groupId, run);
  }
  const open = [...latest.values()].filter(needsClassification);
  if (!open.length) return undefined;
  return `Classify the latest failed run of ${open.map((run) => `${run.groupId} (${run.runKey})`).join(', ')} first: bun run test:runs classify <run-key> <class> "<cause>" "<prevention>".`;
}

/**
 * The two classes that keep `harness` a measure of proven tests need their
 * evidence: `authoring` only when the group's test inputs never passed on
 * their current content, `accepted-change` only for the visual references.
 */
export function classificationProblem(input: {
  classification: string;
  run: BrowserGroupRunEvidence;
  runs: readonly BrowserGroupRunEvidence[];
}): string | undefined {
  if (input.classification === 'accepted-change' && input.run.groupId !== 'audit:visual')
    return 'accepted-change applies to a visual reference that an accepted design change made stale (audit:visual) only.';
  if (input.classification !== 'authoring') return undefined;
  const { groupId, groupFingerprint } = input.run;
  if (!groupId || !groupFingerprint)
    return 'authoring applies to a group run whose test inputs are fingerprinted; this run has none.';
  const proven = input.runs.find(
    (run) =>
      run.groupId === groupId &&
      run.groupFingerprint === groupFingerprint &&
      run.startedAt < input.run.startedAt &&
      completeCleanPass(run),
  );
  return proven
    ? `${groupId} passed on these test inputs in ${proven.runKey}: a failure of proven test code is product, harness, environment or transient, not authoring.`
    : undefined;
}
