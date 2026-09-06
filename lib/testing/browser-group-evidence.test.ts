import { expect, test } from "bun:test";
import { browserGroupReuseProblem, unresolvedBrowserGroupIds, type BrowserGroupRunEvidence } from "./browser-group-evidence";
import { selectRequiredGroups } from "./group-selection";
import type { GroupResult } from "./group-evidence";

const run: BrowserGroupRunEvidence = {
  runKey: "qualified-run", groupId: "audit:p1-22", groupFingerprint: "a".repeat(64), target: "local", lane: "group", status: "passed",
  startedAt: "2026-09-06T10:00:00.000Z", completedAt: "2026-09-06T10:01:00.000Z",
  cleanedAt: "2026-09-06T10:00:59.000Z", retainedAt: null, buildId: "build-one",
  total: 3, passed: 3, failed: 0, skipped: 0, failures: [],
};
const result: GroupResult = {
  groupId: "audit:p1-22", fingerprint: "a".repeat(64), status: "passed",
  startedAt: run.startedAt, completedAt: run.completedAt!, durationMs: 60_000,
  runKey: run.runKey, buildId: run.buildId, logPath: "group.log", reason: null,
};
function problem(runs: readonly BrowserGroupRunEvidence[], candidate: GroupResult = result): string | undefined {
  return browserGroupReuseProblem({ result: candidate, target: "local", runs });
}

test("a complete referenced group pass remains reusable", () => {
  expect(problem([run])).toBeUndefined();
});

test("a direct failed group stays required with no changed files or verifier failure report", () => {
  const failed = { ...run, runKey: "direct-failed", status: "failed" as const, startedAt: "2026-09-06T11:00:00.000Z" };
  const unresolvedGroupIds = unresolvedBrowserGroupIds([failed, run], "local");
  expect(unresolvedGroupIds).toEqual([run.groupId!]);
  expect(selectRequiredGroups({ mode: "change", groups: [{ id: run.groupId!, kind: "audit", inputs: [] }], changedFiles: [], unresolvedGroupIds })).toEqual([run.groupId!]);
  expect(unresolvedBrowserGroupIds([failed], "cloud")).toEqual([]);
  expect(unresolvedBrowserGroupIds([{ ...run, runKey: "later-pass", startedAt: "2026-09-06T12:00:00.000Z" }, failed], "local")).toEqual([]);
});

test("a missing, ambiguous, or changed referenced run cannot be reused", () => {
  expect(problem([])).toContain("missing or ambiguous");
  expect(problem([run, run])).toContain("missing or ambiguous");
  for (const change of [
    { groupId: "audit:another" }, { groupFingerprint: "b".repeat(64) }, { groupFingerprint: undefined }, { target: "cloud" as const }, { buildId: "different-build" },
  ]) expect(problem([{ ...run, ...change }])).toContain("identity");
});

test("incomplete, failed, skipped, and retained references invalidate the report pass", () => {
  for (const change of [
    { status: "failed" as const }, { status: "running" as const }, { lane: "diagnostic" as const },
    { completedAt: null }, { cleanedAt: null, retainedAt: "2026-09-06T10:01:00.000Z" },
    { skipped: 1 }, { failed: 1 }, { total: 0, passed: 0 }, { passed: 2 },
    { failures: [{ title: "caught deadline", file: null, message: "too slow" }] },
  ]) expect(problem([{ ...run, ...change }])).toContain("complete, cleaned passing");
});

test("a later direct group failure defeats an older verification report pass", () => {
  const failed: BrowserGroupRunEvidence = {
    ...run, runKey: "direct-failure", startedAt: "2026-09-06T11:00:00.000Z",
    status: "failed_retained", cleanedAt: null, retainedAt: "2026-09-06T11:01:00.000Z",
  };
  expect(problem([run, failed])).toContain("direct-failure");
  // Registry order and a subsequent fast pass must not erase this failure.
  const laterPass = { ...run, runKey: "direct-pass", startedAt: "2026-09-06T12:00:00.000Z" };
  expect(problem([laterPass, failed, run])).toContain("direct-failure");
});

test("a later running or interrupted group cannot leave an older report green", () => {
  for (const status of ["starting", "running", "interrupted", "diagnostic_passed"] as const) {
    expect(problem([run, { ...run, runKey: "unfinished", startedAt: "2026-09-06T11:00:00.000Z", status, completedAt: null, cleanedAt: null }])).toContain("unfinished");
  }
});

test("other groups, targets, and failures preceding the qualified pass do not invalidate it", () => {
  const failed = { ...run, status: "failed" as const, runKey: "failure" };
  expect(problem([
    { ...failed, groupId: "audit:other", startedAt: "2026-09-06T11:00:00.000Z" },
    { ...failed, target: "cloud", startedAt: "2026-09-06T11:00:00.000Z" },
    { ...failed, startedAt: "2026-09-06T09:00:00.000Z" },
    run,
  ])).toBeUndefined();
});

test("invalid dates or a result without browser identity fail closed", () => {
  expect(problem([{ ...run, startedAt: "invalid" }])).toContain("valid start");
  expect(problem([run, { ...run, runKey: "unknown-order", startedAt: "invalid" }])).toContain("order");
  expect(problem([run], { ...result, runKey: null })).toContain("identity");
  expect(problem([run], { ...result, status: "blocked" })).toContain("identity");
});
