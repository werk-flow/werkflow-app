import { expect, test } from "bun:test";
import { hashValue, type GroupResult, type InputSnapshot } from "./group-evidence";
import { releaseAttemptProblem, type ReleaseHistoryReport } from "./release-breaker";

const snapshot: InputSnapshot = { version: 1, environment: hashValue("local"), files: { "lib/a.ts": hashValue("a"), "tests/a.spec.ts": hashValue("spec") } };
const current = new Map([
  ["audit:a", { fingerprint: hashValue("audit:a"), inputs: ["lib/a.ts", "tests/a.spec.ts"] }],
  ["golden:integrated", { fingerprint: hashValue("golden"), inputs: ["lib/a.ts"] }],
  ["static:lint", { fingerprint: hashValue("lint"), inputs: ["lib/a.ts"] }],
]);

function result(groupId: string, status: GroupResult["status"], startedAt: string, fingerprint = current.get(groupId)!.fingerprint): GroupResult {
  return { groupId, fingerprint, status, startedAt, completedAt: startedAt, durationMs: 1, runKey: null, buildId: null, logPath: "log", reason: null };
}
function report(id: string, status: "passed" | "failed", startedAt: string, results: GroupResult[], overrides: Partial<ReleaseHistoryReport> = {}): ReleaseHistoryReport {
  return { id, mode: "release", scope: "all-required-groups", status, startedAt, snapshot, results, ...overrides };
}

const failedRelease = report("release-1", "failed", "2026-09-13T08:00:00.000Z", [
  result("audit:a", "failed", "2026-09-13T08:10:00.000Z", hashValue("old-audit:a")),
  result("golden:integrated", "passed", "2026-09-13T08:20:00.000Z"),
  result("static:lint", "blocked", "2026-09-13T08:30:00.000Z"),
]);

test("a passing or absent release history allows a release plan", () => {
  expect(releaseAttemptProblem({ history: [], current, snapshot, incidentLog: "" })).toBeUndefined();
  expect(releaseAttemptProblem({ history: [report("release-0", "passed", "2026-09-12T08:00:00.000Z", [])], current, snapshot, incidentLog: "" })).toBeUndefined();
});

test("a failed group needs a later focused pass on the current inputs; blocked groups do not", () => {
  const problem = releaseAttemptProblem({ history: [failedRelease], current, snapshot, incidentLog: "" });
  expect(problem).toContain("audit:a");
  expect(problem).toContain("bun run test:verify --group audit:a");
  expect(problem).not.toContain("static:lint");
  const earlierPass = report("focused-0", "passed", "2026-09-12T20:00:00.000Z", [result("audit:a", "passed", "2026-09-12T20:00:00.000Z")], { mode: "change", scope: "selected-groups" });
  expect(releaseAttemptProblem({ history: [earlierPass, failedRelease], current, snapshot, incidentLog: "" })).toContain("audit:a");
  const staleInputs = report("focused-1", "passed", "2026-09-13T09:00:00.000Z", [result("audit:a", "passed", "2026-09-13T09:00:00.000Z", hashValue("other inputs"))], { mode: "change", scope: "selected-groups", snapshot: { ...snapshot, files: { ...snapshot.files, "lib/a.ts": hashValue("earlier a") } } });
  expect(releaseAttemptProblem({ history: [failedRelease, staleInputs], current, snapshot, incidentLog: "" })).toContain("audit:a");
  const proof = report("focused-2", "passed", "2026-09-13T10:00:00.000Z", [result("audit:a", "passed", "2026-09-13T10:00:00.000Z")], { mode: "change", scope: "selected-groups" });
  expect(releaseAttemptProblem({ history: [failedRelease, proof], current, snapshot, incidentLog: "" })).toBeUndefined();
  const laterFailure = report("focused-3", "failed", "2026-09-13T11:00:00.000Z", [result("audit:a", "failed", "2026-09-13T11:00:00.000Z")], { mode: "change", scope: "selected-groups" });
  expect(releaseAttemptProblem({ history: [failedRelease, proof, laterFailure], current, snapshot, incidentLog: "" })).toContain("audit:a");
});

test("a content-unchanged pass under another fingerprint counts, and a removed group is not required", () => {
  const recorded = report("focused-4", "passed", "2026-09-13T10:00:00.000Z", [result("audit:a", "passed", "2026-09-13T10:00:00.000Z", hashValue("older qualification rule"))], { mode: "change", scope: "selected-groups" });
  expect(releaseAttemptProblem({ history: [failedRelease, recorded], current, snapshot, incidentLog: "" })).toBeUndefined();
  const retired = report("release-2", "failed", "2026-09-13T12:00:00.000Z", [result("audit:retired", "failed", "2026-09-13T12:00:00.000Z", hashValue("gone"))]);
  expect(releaseAttemptProblem({ history: [retired], current, snapshot, incidentLog: "" })).toBeUndefined();
});

test("two consecutive failed releases require the incident log to name the latest report", () => {
  const second = report("release-2", "failed", "2026-09-13T12:00:00.000Z", [result("golden:integrated", "failed", "2026-09-13T12:30:00.000Z", hashValue("old-golden"))]);
  const proof = report("focused-5", "passed", "2026-09-13T13:00:00.000Z", [result("golden:integrated", "passed", "2026-09-13T13:00:00.000Z")], { mode: "change", scope: "selected-groups" });
  const problem = releaseAttemptProblem({ history: [failedRelease, second, proof], current, snapshot, incidentLog: "## 2026-09-13: something about release-1 only" });
  expect(problem).toContain("Two consecutive release reports failed");
  expect(problem).toContain("release-2");
  expect(releaseAttemptProblem({ history: [failedRelease, second, proof], current, snapshot, incidentLog: "## 2026-09-13: Release campaign, second run (report `release-2`)" })).toBeUndefined();
  const withoutProof = releaseAttemptProblem({ history: [failedRelease, second], current, snapshot, incidentLog: "" });
  expect(withoutProof).toContain("golden:integrated");
  expect(withoutProof).toContain("Two consecutive");
});
