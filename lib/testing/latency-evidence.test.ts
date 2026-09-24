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
    freshnessMeasurements: 1, readinessMeasurements: 0, scenarioMeasurements: 0, comparisons: [], problems: [], overTarget: [],
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
    freshnessMeasurements: 0, readinessMeasurements: 1, scenarioMeasurements: 0, comparisons: [], problems: [], overTarget: [],
  });
});

test("a readiness record taken after shell readiness has the wrong timing boundary", () => {
  const directory = archive([
    { ...passed, targetMs: 5000, boundary: "shell-visible-to-options" },
  ], "readiness-latencies.ndjson");
  expect(checkLatencyEvidence({ directory }).problems[0]).toContain("timing boundary");
});

// Step 2 scenario archive: registry-validated records with baseline comparison.
import { SCENARIO_ARCHIVE } from "./latency-evidence";
import { MEASUREMENT_VERSION, getMeasuredScenario } from "./measured-scenarios";
import type { PerformanceBaselines } from "./performance-baselines";
import { performanceContextFixture } from "./fixtures/performance";

const scenario = getMeasuredScenario("calendar.board-to-day.covered");
const scenarioRecord = {
  scenarioId: scenario.id, scenarioVersion: scenario.version, measurementVersion: MEASUREMENT_VERSION,
  boundary: scenario.boundary, budgetMs: scenario.budgetMs, profile: scenario.profile, backend: "local",
  buildId: "build-1", sample: 1, measuredMs: 180, status: "visible", correctness: "observed",
  context: performanceContextFixture,
  responsiveness: "within_target", recordedAt: "2026-09-08T10:00:00.000Z",
};
const noBaselines: PerformanceBaselines = { version: 1, measurementVersion: MEASUREMENT_VERSION, tolerance: { relative: 0.25, absoluteMs: 250 }, baselines: [] };
const withBaseline: PerformanceBaselines = {
  ...noBaselines,
  baselines: [{
    scenarioId: scenario.id, scenarioVersion: scenario.version, profile: scenario.profile, backend: "local",
    context: performanceContextFixture,
    referenceMs: 200, samples: [190, 200, 210],
    source: { runKey: "run-1", runKeys: ["run-1"], buildId: "build-0", recordedAt: "2026-09-08T09:00:00.000Z" },
    review: { reason: "initial calibration", reviewedAt: "2026-09-08T09:30:00.000Z" },
  }],
};

test("a registered scenario record within budget qualifies and reports its comparison", () => {
  const directory = archive([1, 2, 3].map((sample) => ({ ...scenarioRecord, sample })), SCENARIO_ARCHIVE);
  const result = checkLatencyEvidence({ directory, requiredScenarios: [scenario.id], baselines: withBaseline });
  expect(result.problems).toEqual([]);
  expect(result.scenarioMeasurements).toBe(3);
  expect(result.comparisons[0]?.comparison.status).toBe("within");
});

test("an observed removal keeps the same hard deadline and cannot hide a slow disappearance", () => {
  const removal = { ...passed, boundary: "before-submit-to-absent" };
  expect(checkLatencyEvidence({ directory: archive([removal]), requireFreshness: true }).problems).toEqual([]);
  expect(checkLatencyEvidence({ directory: archive([{ ...removal, measuredMs: 2_100 }]), requireFreshness: true }).overTarget[0]).toContain("2100ms over the 2000ms target");
  expect(checkLatencyEvidence({ directory: archive([{ ...removal, measuredMs: 2_600 }]), requireFreshness: true }).problems[0]).toContain("2600ms against 2000ms");
});

test("unbaselined Golden calendar readiness retains its five-second navigation deadline", () => {
  const opened = { ...passed, boundary: "navigation-to-usable-content", targetMs: 5_000, measuredMs: 4_000 };
  expect(checkLatencyEvidence({ directory: archive([opened], "readiness-latencies.ndjson"), requireReadiness: true }).problems).toEqual([]);
  expect(checkLatencyEvidence({ directory: archive([{ ...opened, measuredMs: 5_001 }], "readiness-latencies.ndjson"), requireReadiness: true }).overTarget[0]).toContain("5001ms over the 5000ms target");
  expect(checkLatencyEvidence({ directory: archive([{ ...opened, measuredMs: 6_251 }], "readiness-latencies.ndjson"), requireReadiness: true }).problems[0]).toContain("6251ms against 5000ms");
});

test("a regression below the budget still fails against the reviewed baseline", () => {
  const directory = archive([1, 2, 3].map((sample) => ({ ...scenarioRecord, sample, measuredMs: 480 })), SCENARIO_ARCHIVE);
  const result = checkLatencyEvidence({ directory, baselines: withBaseline });
  expect(result.problems).toHaveLength(1);
  expect(result.problems[0]).toContain("regressed to 480ms");
});

test("a missing baseline is unverified, never a pass, and blocks a required comparison", () => {
  const directory = archive([1, 2, 3].map((sample) => ({ ...scenarioRecord, sample })), SCENARIO_ARCHIVE);
  const calibrating = checkLatencyEvidence({ directory, baselines: noBaselines, scenarios: [{ ...scenario, comparison: "calibrating" }] });
  expect(calibrating.problems).toEqual([]);
  expect(calibrating.comparisons[0]?.comparison.status).toBe("unverified");
  const required = { ...getMeasuredScenario("customers.list.open"), comparison: "required" as const };
  const requiredRecord = { ...scenarioRecord, scenarioId: required.id, boundary: required.boundary, budgetMs: required.budgetMs, profile: required.profile, measuredMs: 900 };
  const strict = checkLatencyEvidence({ directory: archive([1, 2, 3].map((sample) => ({ ...requiredRecord, sample })), SCENARIO_ARCHIVE), baselines: noBaselines, scenarios: [required] });
  expect(strict.comparisons[0]?.comparison.status).toBe("unverified");
  expect(strict.problems).toEqual([expect.stringContaining("comparison is unverified")]);
});

test("widened budgets, obsolete versions, wrong boundaries, unknown ids, and surplus samples fail", () => {
  const directory = archive([
    { ...scenarioRecord, budgetMs: 5_000 },
    { ...scenarioRecord, scenarioVersion: scenario.version + 1 },
    { ...scenarioRecord, boundary: "navigation-to-usable-content" },
    { ...scenarioRecord, scenarioId: "calendar.unregistered" },
    { ...scenarioRecord, sample: 4 },
    scenarioRecord,
  ], SCENARIO_ARCHIVE);
  const result = checkLatencyEvidence({ directory, baselines: noBaselines });
  for (const expected of ["budget 5000ms is not the approved", "obsolete scenario version", "boundary navigation-to-usable-content is not", "unknown scenario calendar.unregistered", "unexpected duplicate or surplus sample"]) {
    expect(result.problems.some((problem) => problem.includes(expected))).toBe(true);
  }
  // Repeated sample 1 and out-of-range sample 4 cannot form a valid cohort.
  expect(result.problems.filter((problem) => problem.includes("surplus sample"))).toHaveLength(4);
});

test("a required scenario that stopped recording fails the group", () => {
  const directory = archive([], SCENARIO_ARCHIVE);
  const result = checkLatencyEvidence({ directory, requiredScenarios: [scenario.id], baselines: noBaselines });
  expect(result.problems).toEqual([`${SCENARIO_ARCHIVE}: required scenario ${scenario.id} recorded 0 of 3 samples.`]);
});

test("an over-budget scenario fails even when it beats its baseline", () => {
  const [reference] = withBaseline.baselines;
  if (!reference) throw new Error("expected a baseline");
  const generous: PerformanceBaselines = { ...withBaseline, baselines: [{ ...reference, referenceMs: 490 }] };
  const directory = archive([{ ...scenarioRecord, measuredMs: 501, responsiveness: "over_target" }], SCENARIO_ARCHIVE);
  expect(checkLatencyEvidence({ directory, baselines: generous }).problems[0]).toContain("over budget");
});


test("median comparison retains an isolated delay but rejects a repeatable slowdown", () => {
  const run = (values: number[]) => checkLatencyEvidence({
    directory: archive(values.map((measuredMs, index) => ({ ...scenarioRecord, sample: index + 1, measuredMs })), SCENARIO_ARCHIVE), baselines: withBaseline,
  });
  const within = run([200, 210, 480]);
  expect(within.problems).toEqual([]);
  expect(within.comparisons).toHaveLength(1);
  expect(within.comparisons[0]).toMatchObject({ basis: "median", sample: null, measuredMs: 210, samples: [expect.objectContaining({ measuredMs: 200 }), expect.objectContaining({ measuredMs: 210 }), expect.objectContaining({ measuredMs: 480 })] });
  expect(run([200, 480, 490]).problems[0]).toContain("regressed to 480ms");
  expect(run([200, 210, 501]).problems[0]).toContain("over budget");
});

test("median comparison fails closed for missing, duplicate, mixed and failed samples", () => {
  const records = [1, 2, 3].map((sample) => ({ ...scenarioRecord, sample }));
  const variants = [
    records.slice(0, 2),
    [records[0], records[1], records[1]],
    [records[0], records[1], { ...records[2], buildId: "another-build" }],
    [records[0], records[1], { ...records[2], backend: "cloud" }],
    [records[0], records[1], { ...records[2], context: { ...performanceContextFixture, viewport: { width: 800, height: 900 } } }],
    [records[0], records[1], { ...records[2], status: "mutation_failed", correctness: "unconfirmed" }],
  ];
  for (const samples of variants) {
    const result = checkLatencyEvidence({ directory: archive(samples, SCENARIO_ARCHIVE), baselines: withBaseline });
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.comparisons[0]?.comparison.status).toBe("unverified");
  }
});

test("a freshness sample over the target but inside the tolerance is recorded and does not fail", () => {
  const directory = archive([{ ...passed, measuredMs: 2100, responsiveness: "over_target" }, passed]);
  const result = checkLatencyEvidence({ directory, requireFreshness: true, requireReadiness: false });
  expect(result.problems).toEqual([]);
  expect(result.overTarget).toHaveLength(1);
  expect(result.overTarget[0]).toContain("2100ms over the 2000ms target");
  const beyond = archive([{ ...passed, measuredMs: 2501, responsiveness: "over_target" }]);
  expect(checkLatencyEvidence({ directory: beyond, requireFreshness: true, requireReadiness: false }).problems[0]).toContain("tolerance limit 2500ms");
});
