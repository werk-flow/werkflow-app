import { expect, test } from "bun:test";
import { draftPerformanceBaselines, type CalibrationRun } from "./performance-calibration";
import { getMeasuredScenario, MEASUREMENT_VERSION } from "./measured-scenarios";
import { performanceContextFixture } from "./fixtures/performance";
import type { PerformanceBaselines } from "./performance-baselines";

const scenario = getMeasuredScenario("calendar.board-to-day.covered");
const existing: PerformanceBaselines = { version: 1, measurementVersion: MEASUREMENT_VERSION, tolerance: { relative: 0.25, absoluteMs: 250 }, baselines: [] };
const run: CalibrationRun = {
  runKey: "owned-run", buildId: "build-1", passed: true, cleaned: true, diagnostic: false, currentInputs: true,
  observations: [180, 200, 220].map((measuredMs, index) => ({
    scenarioId: scenario.id, scenarioVersion: scenario.version, measurementVersion: MEASUREMENT_VERSION,
    boundary: scenario.boundary, budgetMs: scenario.budgetMs, profile: scenario.profile, backend: "local", buildId: "build-1",
    context: performanceContextFixture, sample: index + 1, measuredMs, status: "visible", correctness: "observed", responsiveness: "within_target", recordedAt: "2026-09-08T10:00:00.000Z",
  })),
};
const input = { runs: [run], scenarios: [scenario], existing, scenarioIds: [scenario.id], reason: "Reviewed three fresh-context samples for the fixed typical workload.", reviewedAt: "2026-09-08T10:10:00.000Z" };

test("calibration retains all samples and creates a reviewable median without altering tolerance", () => {
  const draft = draftPerformanceBaselines(input);
  expect(draft.baselines[0]?.samples).toEqual([180, 200, 220]);
  expect(draft.baselines[0]?.referenceMs).toBe(200);
  expect(draft.baselines[0]?.source.runKeys).toEqual(["owned-run"]);
  expect(draft.tolerance).toEqual(existing.tolerance);
  expect(existing.baselines).toEqual([]);
});

test("failed, diagnostic, uncleaned, stale, duplicate or undersampled runs cannot create a baseline", () => {
  for (const invalid of [
    { ...run, passed: false }, { ...run, cleaned: false }, { ...run, diagnostic: true }, { ...run, currentInputs: false },
    { ...run, observations: run.observations.slice(0, 2) },
    { ...run, observations: run.observations.map((record) => ({ ...record, measuredMs: 501 })) },
    { ...run, observations: run.observations.map((record, index) => index ? record : { ...record, context: { ...record.context, protocol: "other" } }) },
  ]) expect(() => draftPerformanceBaselines({ ...input, runs: [invalid] })).toThrow();
  expect(() => draftPerformanceBaselines({ ...input, runs: [run, run] })).toThrow("same sample twice");
});

test("calibration cannot automatically replace an existing reviewed reference", () => {
  const reviewed = draftPerformanceBaselines(input);
  expect(() => draftPerformanceBaselines({ ...input, existing: reviewed })).toThrow("already has a compatible reviewed reference");
});
