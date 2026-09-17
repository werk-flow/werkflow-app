import { expect, test } from "bun:test";

import { MEASUREMENT_VERSION, MEASURED_SCENARIOS, validateMeasuredScenarios } from "./measured-scenarios";
import {
  compareToBaseline,
  readPerformanceBaselines,
  validatePerformanceBaselines,
  findBaseline,
  type PerformanceBaseline,
} from "./performance-baselines";
import { performanceContextFixture } from "./fixtures/performance";

const tolerance = { relative: 0.25, absoluteMs: 250 };
const baseline: PerformanceBaseline = {
  scenarioId: "calendar.day.cold-open", scenarioVersion: 1, profile: "typical", backend: "local",
  context: performanceContextFixture,
  referenceMs: 1_000, samples: [980, 1_000, 1_020],
  source: { runKey: "run-1", runKeys: ["run-1"], buildId: "build-1", recordedAt: "2026-09-08T09:00:00.000Z" },
  review: { reason: "initial calibration", reviewedAt: "2026-09-08T09:30:00.000Z" },
};

test("the committed registry and baseline file are internally consistent", () => {
  expect(validateMeasuredScenarios()).toEqual([]);
  const baselines = readPerformanceBaselines();
  expect(validatePerformanceBaselines(baselines, MEASURED_SCENARIOS)).toEqual([]);
  // A required comparison without a committed baseline would block every run; the
  // registry may only require a comparison once the baseline exists.
  for (const scenario of MEASURED_SCENARIOS.filter((entry) => entry.comparison === "required")) {
    expect(baselines.baselines.some((entry) => entry.scenarioId === scenario.id && entry.scenarioVersion === scenario.version)).toBe(true);
  }
});

test("the frozen comparison rule needs both tolerances to call a regression or an improvement", () => {
  const compare = (measuredMs: number) => compareToBaseline({ measuredMs, baseline, tolerance, measurementVersion: MEASUREMENT_VERSION }).status;
  expect(compare(1_240)).toBe("within");
  expect(compare(1_251)).toBe("regressed");
  expect(compare(760)).toBe("within");
  expect(compare(749)).toBe("improved");
  // A fast scenario: 200 ms reference, 25% is 50 ms, so the absolute 250 ms governs.
  const fast = { ...baseline, referenceMs: 200 };
  expect(compareToBaseline({ measuredMs: 440, baseline: fast, tolerance, measurementVersion: MEASUREMENT_VERSION }).status).toBe("within");
  expect(compareToBaseline({ measuredMs: 451, baseline: fast, tolerance, measurementVersion: MEASUREMENT_VERSION }).status).toBe("regressed");
});

test("a changed measurement version or missing baseline is unverified, not within", () => {
  expect(compareToBaseline({ measuredMs: 100, baseline: undefined, tolerance, measurementVersion: MEASUREMENT_VERSION }).status).toBe("unverified");
  expect(compareToBaseline({ measuredMs: 100, baseline, tolerance, measurementVersion: MEASUREMENT_VERSION + 1 }).status).toBe("unverified");
});

test("a baseline slower than the budget, for an unknown scenario, or duplicated is rejected", () => {
  const scenarios = MEASURED_SCENARIOS;
  const slow = { version: 1 as const, measurementVersion: MEASUREMENT_VERSION, tolerance, baselines: [{ ...baseline, referenceMs: 6_000 }] };
  expect(validatePerformanceBaselines(slow, scenarios)[0]).toContain("exceeds the 5000ms budget");
  const unknown = { ...slow, baselines: [{ ...baseline, scenarioId: "nope.scenario" }] };
  expect(validatePerformanceBaselines(unknown, scenarios)[0]).toContain("unknown scenario");
  const duplicate = { ...slow, baselines: [baseline, baseline] };
  expect(validatePerformanceBaselines(duplicate, scenarios)[0]).toContain("Duplicate baseline");
  const stale = { ...slow, measurementVersion: MEASUREMENT_VERSION + 1, baselines: [] };
  expect(validatePerformanceBaselines(stale, scenarios)[0]).toContain("measurement version");
});

test("workload, cache protocol, role, browser and machine mismatches cannot compare", () => {
  const baselines = { version: 1 as const, measurementVersion: MEASUREMENT_VERSION, tolerance, baselines: [baseline] };
  const input = { baselines, scenarioId: baseline.scenarioId, scenarioVersion: baseline.scenarioVersion, profile: baseline.profile, backend: baseline.backend, context: performanceContextFixture };
  expect(findBaseline(input)).toEqual(baseline);
  for (const context of [
    { ...performanceContextFixture, workloadDigest: "c".repeat(64) },
    { ...performanceContextFixture, measurementDigest: "d".repeat(64) },
    { ...performanceContextFixture, protocol: "warm-tab-v2" },
    { ...performanceContextFixture, role: "employee" as const },
    { ...performanceContextFixture, browserVersion: "another-browser" },
    { ...performanceContextFixture, viewport: { width: 375, height: 900 } },
    { ...performanceContextFixture, cpuModel: "different-cpu" },
    { ...performanceContextFixture, providerDigest: "d".repeat(64) },
  ]) expect(findBaseline({ ...input, context })).toBeUndefined();
  // The old application's build is provenance, not a compatibility key:
  // a new app build is precisely what the unchanged experiment compares.
  const olderBuild = { ...baselines, baselines: [{ ...baseline, source: { ...baseline.source, buildId: "old-app-build" } }] };
  expect(findBaseline({ ...input, baselines: olderBuild })?.referenceMs).toBe(1_000);
});

test("manual baseline activation cannot bypass sample, provenance or tolerance policy", () => {
  const valid = { version: 1 as const, measurementVersion: MEASUREMENT_VERSION, tolerance, baselines: [baseline] };
  for (const invalid of [
    { ...valid, tolerance: { relative: 1, absoluteMs: 10_000 } },
    { ...valid, baselines: [{ ...baseline, samples: [1000] }] },
    { ...valid, baselines: [{ ...baseline, samples: [980, 1000, 6000] }] },
    { ...valid, baselines: [{ ...baseline, referenceMs: 1200 }] },
    { ...valid, baselines: [{ ...baseline, source: { ...baseline.source, buildId: "" } }] },
    { ...valid, baselines: [{ ...baseline, source: { ...baseline.source, runKeys: ["other-run"] } }] },
    { ...valid, baselines: [{ ...baseline, source: { ...baseline.source, runKeys: ["run-1", "run-1"] } }] },
  ]) expect(validatePerformanceBaselines(invalid, MEASURED_SCENARIOS).length).toBeGreaterThan(0);
});

test("malformed baseline input returns validation findings without dereferencing missing fields", () => {
  const valid = { version: 1, measurementVersion: MEASUREMENT_VERSION, tolerance, baselines: [baseline] };
  for (const malformed of [null, undefined, {}, { ...valid, tolerance: null },
    { ...valid, baselines: [{ ...baseline, samples: undefined }] },
    { ...valid, baselines: [{ ...baseline, source: undefined }] },
    { ...valid, baselines: [null] },
  ]) {
    expect(() => validatePerformanceBaselines(malformed, MEASURED_SCENARIOS)).not.toThrow();
    expect(validatePerformanceBaselines(malformed, MEASURED_SCENARIOS)[0]).toContain("Invalid baseline shape");
  }
});
