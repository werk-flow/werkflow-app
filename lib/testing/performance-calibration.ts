import type { ScenarioObservation } from "./latency-evidence";
import { MEASUREMENT_VERSION, type MeasuredScenario } from "./measured-scenarios";
import type { PerformanceBaseline, PerformanceBaselines } from "./performance-baselines";
import { samePerformanceContext } from "./performance-context";

export type CalibrationRun = {
  runKey: string;
  buildId: string;
  passed: boolean;
  cleaned: boolean;
  diagnostic: boolean;
  currentInputs: boolean;
  observations: readonly ScenarioObservation[];
};

/** Creates a draft only. Application source and failed measurements never become automatic references. */
export function draftPerformanceBaselines(input: {
  runs: readonly CalibrationRun[];
  scenarios: readonly MeasuredScenario[];
  existing: PerformanceBaselines;
  scenarioIds: readonly string[];
  reason: string;
  reviewedAt: string;
}): PerformanceBaselines {
  if (!input.reason.trim()) throw new Error("Calibration needs a concrete review reason.");
  if (!input.runs.length || input.runs.length > 3) throw new Error("Calibration accepts one to three declared fresh runs.");
  if (new Set(input.runs.map((run) => run.runKey)).size !== input.runs.length) throw new Error("A run cannot supply the same sample twice.");
  if (!input.scenarioIds.length) throw new Error("Calibration requires at least one named scenario.");
  for (const run of input.runs) {
    if (!run.passed || !run.cleaned || run.diagnostic || !run.currentInputs) throw new Error(`Run ${run.runKey} is not successful, cleaned, fresh evidence for current inputs.`);
  }
  const added: PerformanceBaseline[] = [];
  for (const id of [...new Set(input.scenarioIds)]) {
    const scenario = input.scenarios.find((entry) => entry.id === id);
    if (!scenario) throw new Error(`Unknown calibration scenario ${id}.`);
    const evidence = input.runs.flatMap((run) => run.observations.filter((record) => record.scenarioId === id).map((record) => ({ run, record })));
    const [first] = evidence;
    if (evidence.length < 3 || evidence.length > 9 || !first) throw new Error(`${id} needs three to nine declared successful samples; found ${evidence.length}.`);
    if (new Set(evidence.map(({ run, record }) => `${run.runKey}/${record.sample}`)).size !== evidence.length) throw new Error(`${id} contains duplicate sample identities.`);
    for (const { record, run } of evidence) {
      if (record.status !== "visible" || record.correctness !== "observed" || record.responsiveness !== "within_target" || record.measuredMs > scenario.budgetMs) throw new Error(`${id} contains failed or over-budget evidence.`);
      if (record.scenarioVersion !== scenario.version || record.measurementVersion !== MEASUREMENT_VERSION || record.budgetMs !== scenario.budgetMs || record.boundary !== scenario.boundary || record.profile !== scenario.profile) throw new Error(`${id} contains obsolete or altered measurement contracts.`);
      if (record.buildId !== run.buildId || record.buildId !== first.run.buildId || record.backend !== first.record.backend || !samePerformanceContext(record.context, first.record.context)) throw new Error(`${id} samples do not share a build, workload and measurement environment.`);
    }
    if (input.existing.baselines.some((entry) => entry.scenarioId === id && entry.scenarioVersion === scenario.version && entry.backend === first.record.backend && samePerformanceContext(entry.context, first.record.context))) throw new Error(`${id} already has a compatible reviewed reference; replacement requires an explicit reviewed file change.`);
    const samples = evidence.map(({ record }) => record.measuredMs).sort((left, right) => left - right);
    const midpoint = Math.floor(samples.length / 2);
    const [lower, upper] = samples.length % 2 ? [samples[midpoint], samples[midpoint]] : [samples[midpoint - 1], samples[midpoint]];
    if (lower === undefined || upper === undefined) throw new Error(`${id} has no samples for a median reference.`);
    const referenceMs = (lower + upper) / 2;
    added.push({
      scenarioId: id, scenarioVersion: scenario.version, profile: scenario.profile, backend: first.record.backend,
      context: first.record.context, referenceMs, samples,
      source: { runKey: first.run.runKey, runKeys: [...new Set(evidence.map(({ run }) => run.runKey))], buildId: first.run.buildId, recordedAt: evidence.at(-1)!.record.recordedAt },
      review: { reason: input.reason, reviewedAt: input.reviewedAt },
    });
  }
  return { ...input.existing, measurementVersion: MEASUREMENT_VERSION, baselines: [...input.existing.baselines, ...added] };
}
