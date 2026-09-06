import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLatencyEvidence } from "./latency-evidence";

const directories: string[] = [];
function archive(records: readonly unknown[], filename = "live-latencies.ndjson"): string {
  const directory = mkdtempSync(join(tmpdir(), "werkflow-latency-evidence-"));
  directories.push(directory);
  writeFileSync(join(directory, filename), records.map((record) => JSON.stringify(record)).join("\n"));
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const passed = {
  label: "cross-session record", backend: "local", measuredMs: 1500, targetMs: 2000,
  status: "visible", correctness: "observed", responsiveness: "within_target",
  boundary: "before-submit-to-visible",
};

test("valid measurements qualify without requiring unrelated timing kinds", () => {
  expect(checkLatencyEvidence({ directory: archive([passed]), requireFreshness: true })).toEqual({
    freshnessMeasurements: 1, readinessMeasurements: 0, problems: [],
  });
});

test("a caught slow failure cannot be erased by a later fast pass", () => {
  const directory = archive([{ ...passed, measuredMs: 10_000, responsiveness: "over_target" }, passed]);
  const result = checkLatencyEvidence({ directory });
  expect(result.freshnessMeasurements).toBe(2);
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toContain("10000ms against 2000ms");
});

test("a lying within-target flag or enlarged deadline cannot certify slow evidence", () => {
  const directory = archive([{ ...passed, measuredMs: 10_000, targetMs: 15_000 }]);
  expect(checkLatencyEvidence({ directory }).problems).toHaveLength(2);
});

test("failed and uncertain observations remain unqualified", () => {
  const directory = archive([
    { ...passed, status: "observation_failed", correctness: "not_observed", responsiveness: "unconfirmed" },
    { ...passed, status: "mutation_failed", correctness: "unconfirmed", responsiveness: "unconfirmed" },
  ]);
  expect(checkLatencyEvidence({ directory }).problems).toHaveLength(4);
});

test("required evidence cannot silently disappear", () => {
  const directory = archive([]);
  expect(checkLatencyEvidence({ directory, requireFreshness: true, requireReadiness: true }).problems).toHaveLength(2);
});

test("malformed and old warning-only archives fail closed", () => {
  const directory = archive([{ measuredMs: 1000, overTarget: false }]);
  writeFileSync(join(directory, "readiness-latencies.ndjson"), "{truncated");
  expect(checkLatencyEvidence({ directory }).problems).toHaveLength(2);
});

test("readiness validates its separate opening-to-usable deadline", () => {
  const directory = archive([
    { ...passed, targetMs: 5000, measuredMs: 4500, boundary: "opening-action-to-usable-control" },
  ], "readiness-latencies.ndjson");
  expect(checkLatencyEvidence({ directory, requireReadiness: true })).toEqual({
    freshnessMeasurements: 0, readinessMeasurements: 1, problems: [],
  });
});

test("a readiness record taken after shell readiness has the wrong timing boundary", () => {
  const directory = archive([
    { ...passed, targetMs: 5000, boundary: "shell-visible-to-options" },
  ], "readiness-latencies.ndjson");
  expect(checkLatencyEvidence({ directory }).problems[0]).toContain("timing boundary");
});
