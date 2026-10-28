import { reusableGroupResult, type GroupResult, type InputSnapshot } from '../evidence/group-evidence';

/**
 * The release-plan circuit breaker. A full release run proves no repair: the failed group does.
 *
 * 1. After a failed release report, every group that failed in it needs a later passing result on
 *    the current inputs before the next release plan. Content-based reuse then reruns only what
 *    changed.
 * 2. After two consecutive failed release reports, the latest one needs a written diagnosis and
 *    harness hypothesis in its folder (`RELEASE_DIAGNOSIS_FILE`) before anything runs again.
 */
export type ReleaseHistoryReport = {
  id: string;
  mode: 'change' | 'release';
  scope: 'selected-groups' | 'all-required-groups';
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  snapshot: InputSnapshot;
  results: readonly GroupResult[];
};

export type CurrentGroupInputs = ReadonlyMap<string, { fingerprint: string; inputs: readonly string[] }>;

/** The diagnosis of a failed release report, in the report's folder under `.agent-logs/verification`. */
export const RELEASE_DIAGNOSIS_FILE = 'diagnosis.md';

export function releaseAttemptProblem(input: {
  /** Reports of the same target, in start order. */
  history: readonly ReleaseHistoryReport[];
  current: CurrentGroupInputs;
  snapshot: InputSnapshot;
  /** Whether the report's folder holds its `RELEASE_DIAGNOSIS_FILE`. */
  hasDiagnosis: (reportId: string) => boolean;
}): string | undefined {
  const releases = input.history.filter(
    (report) =>
      report.mode === 'release' && report.scope === 'all-required-groups' && report.status !== 'running',
  );
  const latest = releases.at(-1);
  if (!latest || latest.status === 'passed') return undefined;
  const problems: string[] = [];
  const later = input.history
    .filter((report) => report.startedAt > latest.startedAt)
    .flatMap((report) => report.results.map((result) => ({ ...result, snapshot: report.snapshot })));
  const unproven = latest.results
    .filter((result) => result.status === 'failed')
    .map((result) => result.groupId)
    .filter((groupId) => {
      const group = input.current.get(groupId);
      if (!group) return false;
      return !reusableGroupResult({
        groupId,
        fingerprint: group.fingerprint,
        inputs: group.inputs,
        snapshot: input.snapshot,
        results: later,
      });
    });
  if (unproven.length) {
    problems.push(
      `Release report ${latest.id} failed and ${unproven.join(', ')} ${unproven.length === 1 ? 'has' : 'have'} no later passing result on the current inputs. Prove the repair first: bun run test:verify --group ${unproven.join(',')}`,
    );
  }
  const previousRelease = releases.at(-2);
  if (previousRelease?.status === 'failed' && !input.hasDiagnosis(latest.id)) {
    problems.push(
      `Two consecutive release reports failed (${previousRelease.id}, ${latest.id}). Write the diagnosis and a harness hypothesis into .agent-logs/verification/${latest.id}/${RELEASE_DIAGNOSIS_FILE} before the next attempt.`,
    );
  }
  return problems.length ? `${problems.join(' ')} (docs/technical/testing.md, "Release mode")` : undefined;
}
