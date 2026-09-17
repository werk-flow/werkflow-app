import { reusableGroupResult, type GroupResult, type InputSnapshot } from "./group-evidence";

/**
 * The release-plan circuit breaker (pre-Wave-3 step 1, 2026-09-14). The Step 3
 * campaign needed eleven full release runs because every repair was proven by
 * the next full run instead of by the failed group alone; the certification
 * lane's budget never saw them because release runs use the group lane. Two
 * rules, both mechanical:
 *
 * 1. After a failed release report, every group that failed in it needs a
 *    later passing result on the current inputs before the next release plan.
 *    With content-based reuse the release run then reruns only what changed.
 * 2. After two consecutive failed release reports, the incident log must name
 *    the latest failed report before anything runs again: a written diagnosis
 *    and harness hypothesis, not another attempt.
 */
export type ReleaseHistoryReport = {
  id: string;
  mode: "change" | "release";
  scope: "selected-groups" | "all-required-groups";
  status: "running" | "passed" | "failed";
  startedAt: string;
  snapshot: InputSnapshot;
  results: readonly GroupResult[];
};

export type CurrentGroupInputs = ReadonlyMap<string, { fingerprint: string; inputs: readonly string[] }>;

export const INCIDENT_LOG_PATH = "docs/technical/test-incident-log.md";

export function releaseAttemptProblem(input: {
  /** Reports of the same target, in start order. */
  history: readonly ReleaseHistoryReport[];
  current: CurrentGroupInputs;
  snapshot: InputSnapshot;
  incidentLog: string;
}): string | undefined {
  const releases = input.history.filter((report) => report.mode === "release" && report.scope === "all-required-groups" && report.status !== "running");
  const latest = releases.at(-1);
  if (!latest || latest.status === "passed") return undefined;
  const problems: string[] = [];
  const later = input.history.filter((report) => report.startedAt > latest.startedAt)
    .flatMap((report) => report.results.map((result) => ({ ...result, snapshot: report.snapshot })));
  const unproven = latest.results.filter((result) => result.status === "failed").map((result) => result.groupId).filter((groupId) => {
    const group = input.current.get(groupId);
    if (!group) return false;
    return !reusableGroupResult({ groupId, fingerprint: group.fingerprint, inputs: group.inputs, snapshot: input.snapshot, results: later });
  });
  if (unproven.length) {
    problems.push(`Release report ${latest.id} failed and ${unproven.join(", ")} ${unproven.length === 1 ? "has" : "have"} no later passing result on the current inputs. Prove the repair first: bun run test:verify --group ${unproven.join(",")}`);
  }
  if (releases.at(-2)?.status === "failed" && !input.incidentLog.includes(latest.id)) {
    problems.push(`Two consecutive release reports failed (${releases.at(-2)!.id}, ${latest.id}). Write the diagnosis and a harness hypothesis into ${INCIDENT_LOG_PATH} naming report ${latest.id} before the next attempt.`);
  }
  return problems.length ? `${problems.join(" ")} (docs/technical/testing.md, "After a failed run")` : undefined;
}
