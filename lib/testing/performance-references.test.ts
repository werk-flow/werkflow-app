import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { MEASURED_SCENARIOS } from "./measured-scenarios";
import { readPerformanceBaselines } from "./performance-baselines";
import { measurementDigest } from "./performance-context";

const repositoryRoot = resolve(import.meta.dir, "../..");

// A `required` scenario whose reference does not match the current measurement
// digest fails its group with "no reviewed baseline" although every sample may
// be within target (2026-09-17: six digest inputs were edited after the last
// transfer and all eleven references were orphaned without anyone noticing until
// the next release plan). Either recalibrate and activate a reference at the
// current digest, or mark the scenario `calibrating` until that happens.
test("every required scenario has a reviewed reference at the current measurement digest", () => {
  const baselines = readPerformanceBaselines();
  const orphaned = MEASURED_SCENARIOS.filter((scenario) => scenario.comparison === "required").filter((scenario) => {
    const digest = measurementDigest(repositoryRoot, scenario);
    return !baselines.baselines.some((baseline) => baseline.scenarioId === scenario.id && baseline.scenarioVersion === scenario.version && baseline.context.measurementDigest === digest);
  }).map((scenario) => scenario.id);
  expect(orphaned).toEqual([]);
});
