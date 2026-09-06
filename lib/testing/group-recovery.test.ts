import { expect, test } from "bun:test";
import { recoveredEnvironmentRuns } from "./group-recovery";

test("environment recovery requires matching successful retained diagnosis and owned cleanup", () => {
  const failed = { runKey: "failed", sourceRunKey: null, status: "failed_retained", classification: "environment", cleanedAt: "2026-09-06T11:00:00Z", startedAt: "2026-09-06T09:00:00Z", completedAt: "2026-09-06T09:01:00Z", target: "local", candidateFingerprint: "same" };
  const diagnostic = { ...failed, runKey: "diagnostic", sourceRunKey: "failed", status: "diagnostic_passed", startedAt: "2026-09-06T10:00:00Z" };
  expect(recoveredEnvironmentRuns([failed, diagnostic])).toEqual(["failed"]);
  for (const change of [{ target: "cloud" }, { candidateFingerprint: "different" }, { status: "failed" }, { sourceRunKey: "unrelated" }, { startedAt: "2026-09-06T08:00:00Z" }]) {
    expect(recoveredEnvironmentRuns([failed, { ...diagnostic, ...change }])).toEqual([]);
  }
  expect(recoveredEnvironmentRuns([{ ...failed, cleanedAt: null }, diagnostic])).toEqual([]);
  expect(recoveredEnvironmentRuns([{ ...failed, classification: "product" }, diagnostic])).toEqual([]);
});
