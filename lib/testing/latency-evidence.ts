import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

import { MEASUREMENT_VERSION, MEASURED_SCENARIOS, type MeasuredScenario } from "./measured-scenarios";
import { compareToBaseline, findBaseline, readPerformanceBaselines, type BaselineComparison, type PerformanceBaselines } from "./performance-baselines";
import { performanceContextSchema, samePerformanceContext } from "./performance-context";
import { responsivenessLimitMs } from "./responsiveness-tolerance";

export const LIVE_TARGET_MS = 2_000;
// P1-22's former shell-only budget covers opening through usable options.
export const TIME_CORRECTION_READY_MS = 5_000;
// This timeout bounds diagnosis. It is not the acceptable responsiveness deadline.
export const LIVE_HARD_BUDGET_MS: Record<"local" | "cloud", number> = {
  local: 15_000,
  cloud: 15_000,
};

const observationSchema = z.object({
  label: z.string().min(1),
  backend: z.enum(["local", "cloud"]),
  measuredMs: z.number().finite().nonnegative(),
  targetMs: z.number().finite().positive(),
  status: z.enum(["visible", "observation_failed", "mutation_failed"]),
  correctness: z.enum(["observed", "not_observed", "unconfirmed"]),
  responsiveness: z.enum(["within_target", "over_target", "unconfirmed"]),
  boundary: z.string(),
});

/** Browser-side attribution captured with a scenario; never user data. */
const scenarioAttributionSchema = z.object({
  navigationTtfbMs: z.number().finite().nonnegative().nullable(),
  navigationResponseEndMs: z.number().finite().nonnegative().nullable(),
  requestCount: z.number().int().nonnegative(),
  transferBytes: z.number().finite().nonnegative(),
  rscRequestCount: z.number().int().nonnegative(),
  rscBytes: z.number().finite().nonnegative(),
}).strict();
export type ScenarioAttribution = z.infer<typeof scenarioAttributionSchema>;

/** One record in scenario-latencies.ndjson (the Step 2 evidence archive). */
export const scenarioObservationSchema = z.object({
  scenarioId: z.string().min(1),
  scenarioVersion: z.number().int().positive(),
  measurementVersion: z.number().int().positive(),
  boundary: z.string().min(1),
  budgetMs: z.number().finite().positive(),
  profile: z.enum(["golden-world", "typical"]),
  backend: z.enum(["local", "cloud"]),
  buildId: z.string().min(1).nullable(),
  context: performanceContextSchema,
  sample: z.number().int().positive(),
  measuredMs: z.number().finite().nonnegative(),
  status: z.enum(["visible", "observation_failed", "mutation_failed"]),
  correctness: z.enum(["observed", "not_observed", "unconfirmed"]),
  responsiveness: z.enum(["within_target", "over_target", "unconfirmed"]),
  attribution: scenarioAttributionSchema.optional(),
  recordedAt: z.string().datetime(),
});
export type ScenarioObservation = z.infer<typeof scenarioObservationSchema>;
export const SCENARIO_ARCHIVE = "scenario-latencies.ndjson";

const comparisonSchema = z.union([
  z.object({ status: z.enum(["within", "improved", "regressed"]), referenceMs: z.number(), measuredMs: z.number(), limitMs: z.number() }),
  z.object({ status: z.literal("unverified"), measuredMs: z.number(), reason: z.string() }),
]);

const scenarioComparisonSchema = z.object({
  scenarioId: z.string(), measuredMs: z.number(), budgetMs: z.number(),
  correctness: z.enum(["observed", "not_observed", "unconfirmed"]),
  responsiveness: z.enum(["within_target", "over_target", "unconfirmed"]),
  comparison: comparisonSchema,
}).and(z.union([
  // Historical reports retain their original per-sample verdicts.
  z.object({ sample: z.number(), basis: z.literal("sample").optional() }),
  z.object({ sample: z.null(), basis: z.literal("median"), samples: z.array(scenarioObservationSchema) }),
]));
type ScenarioComparisonResult = z.infer<typeof scenarioComparisonSchema>;

/** Embedded in the verification report; a hard-budget pass does not hide an unverified comparison. */
export const latencyEvidenceSchema = z.object({
  freshnessMeasurements: z.number().int().nonnegative(),
  readinessMeasurements: z.number().int().nonnegative(),
  scenarioMeasurements: z.number().int().nonnegative(),
  comparisons: z.array(scenarioComparisonSchema),
  problems: z.array(z.string()),
  /** Samples over their target but inside the approved tolerance; recorded, not failed. */
  overTarget: z.array(z.string()).default([]),
});

export type LatencyEvidenceCheck = {
  freshnessMeasurements: number;
  readinessMeasurements: number;
  scenarioMeasurements: number;
  comparisons: ScenarioComparisonResult[];
  problems: string[];
  overTarget: string[];
};

/** A caught assertion or later fast retry cannot erase earlier deadline evidence. */
export function checkLatencyEvidence(input: {
  directory: string;
  requireFreshness?: boolean;
  requireReadiness?: boolean;
  /** Scenario ids the group must record, exactly `samples` times each. */
  requiredScenarios?: readonly string[];
  baselines?: PerformanceBaselines;
  /** Explicit registry fixture for negative tests; production callers use the current registry. */
  scenarios?: readonly MeasuredScenario[];
}): LatencyEvidenceCheck {
  const result: LatencyEvidenceCheck = { freshnessMeasurements: 0, readinessMeasurements: 0, scenarioMeasurements: 0, comparisons: [], problems: [], overTarget: [] };
  const archives = [
    { name: "live-latencies.ndjson", count: "freshnessMeasurements", required: input.requireFreshness, targetMs: LIVE_TARGET_MS, boundary: "before-submit-to-visible" },
    { name: "readiness-latencies.ndjson", count: "readinessMeasurements", required: input.requireReadiness, targetMs: TIME_CORRECTION_READY_MS, boundary: "opening-action-to-usable-control" },
  ] as const;
  for (const archive of archives) {
    const lines = readArchiveLines(input.directory, archive.name, result.problems);
    if (lines === undefined) continue;
    if (archive.required && !lines.length) result.problems.push(`${archive.name}: required responsiveness evidence is missing.`);
    for (const [index, line] of lines.entries()) {
      let observation: z.infer<typeof observationSchema>;
      try { observation = observationSchema.parse(JSON.parse(line)); }
      catch {
        result.problems.push(`${archive.name}:${index + 1}: malformed or obsolete responsiveness evidence.`);
        continue;
      }
      result[archive.count] += 1;
      const reference = `${archive.name}:${index + 1} (${observation.label})`;
      const boundaryMatches = observation.boundary === archive.boundary || archive.name === "live-latencies.ndjson" && observation.boundary === "before-submit-to-absent" || archive.name === "readiness-latencies.ndjson" && observation.boundary === "navigation-to-usable-content";
      if (observation.targetMs !== archive.targetMs || !boundaryMatches) {
        result.problems.push(`${reference}: measurement does not use the required ${archive.targetMs}ms contract and timing boundary.`);
      }
      if (observation.status !== "visible" || observation.correctness !== "observed") {
        result.problems.push(`${reference}: correctness was not confirmed; classify the original failure before accepting evidence.`);
      }
      const limitMs = responsivenessLimitMs(archive.targetMs);
      if (observation.measuredMs > limitMs || observation.responsiveness === "unconfirmed") {
        result.problems.push(`${reference}: responsiveness did not pass, measured ${observation.measuredMs}ms against ${archive.targetMs}ms (tolerance limit ${limitMs}ms).`);
      } else if (observation.measuredMs > archive.targetMs || observation.responsiveness === "over_target") {
        result.overTarget.push(`${reference}: ${observation.measuredMs}ms over the ${archive.targetMs}ms target, inside the ${limitMs}ms tolerance limit.`);
      }
    }
  }
  checkScenarioEvidence(input, result);
  return result;
}

function readArchiveLines(directory: string, name: string, problems: string[]): string[] | undefined {
  const path = resolve(directory, name);
  try {
    const contents = existsSync(path) ? readFileSync(path, "utf8") : "";
    return contents.split(/\r?\n/).filter((line) => line.trim());
  } catch {
    problems.push(`${name}: evidence could not be read.`);
    return undefined;
  }
}

function checkScenarioEvidence(
  input: { directory: string; requiredScenarios?: readonly string[]; baselines?: PerformanceBaselines; scenarios?: readonly MeasuredScenario[] },
  result: LatencyEvidenceCheck,
): void {
  const lines = readArchiveLines(input.directory, SCENARIO_ARCHIVE, result.problems);
  if (lines === undefined) return;
  const baselines = input.baselines ?? readPerformanceBaselines();
  const scenarios = input.scenarios ?? MEASURED_SCENARIOS;
  const required = new Set(input.requiredScenarios ?? []);
  const samplesSeen = new Map<string, Set<number>>();
  const cohorts = new Map<string, ScenarioObservation[]>();
  const invalidScenarios = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const reference = `${SCENARIO_ARCHIVE}:${index + 1}`;
    let observation: ScenarioObservation;
    try { observation = scenarioObservationSchema.parse(JSON.parse(line)); }
    catch {
      result.problems.push(`${reference}: malformed scenario evidence.`);
      continue;
    }
    result.scenarioMeasurements += 1;
    const scenario = scenarios.find((entry) => entry.id === observation.scenarioId);
    if (!scenario) {
      result.problems.push(`${reference}: unknown scenario ${observation.scenarioId}; register it before it can qualify.`);
      continue;
    }
    const problemsBefore = result.problems.length;
    const cohort = cohorts.get(scenario.id) ?? [];
    cohort.push(observation);
    cohorts.set(scenario.id, cohort);
    const label = `${reference} (${observation.scenarioId} sample ${observation.sample})`;
    if (observation.scenarioVersion !== scenario.version) result.problems.push(`${label}: obsolete scenario version ${observation.scenarioVersion}; the registry is at ${scenario.version}.`);
    if (observation.measurementVersion !== MEASUREMENT_VERSION) result.problems.push(`${label}: measurement version ${observation.measurementVersion} is not the current ${MEASUREMENT_VERSION}.`);
    if (observation.boundary !== scenario.boundary) result.problems.push(`${label}: boundary ${observation.boundary} is not the registered ${scenario.boundary}.`);
    if (observation.budgetMs !== scenario.budgetMs) result.problems.push(`${label}: budget ${observation.budgetMs}ms is not the approved ${scenario.budgetMs}ms.`);
    if (observation.profile !== scenario.profile) result.problems.push(`${label}: profile ${observation.profile} is not the registered ${scenario.profile}.`);
    const seen = samplesSeen.get(scenario.id) ?? new Set<number>();
    if (seen.has(observation.sample) || observation.sample > scenario.samples) result.problems.push(`${label}: unexpected duplicate or surplus sample; the scenario declares ${scenario.samples}.`);
    seen.add(observation.sample);
    samplesSeen.set(scenario.id, seen);
    if (observation.status !== "visible" || observation.correctness !== "observed") {
      result.problems.push(`${label}: correctness was not confirmed; classify the original failure before accepting evidence.`);
    }
    if (observation.measuredMs > scenario.budgetMs || observation.responsiveness !== "within_target") {
      result.problems.push(`${label}: over budget, measured ${observation.measuredMs}ms against ${scenario.budgetMs}ms.`);
    }
    if (result.problems.length !== problemsBefore) invalidScenarios.add(scenario.id);
  }
  for (const [id, observations] of cohorts) {
    const scenario = scenarios.find((entry) => entry.id === id);
    const first = observations[0];
    if (!scenario || !first) continue;
    if (observations.length !== scenario.samples || samplesSeen.get(id)?.size !== scenario.samples) {
      result.problems.push(`${SCENARIO_ARCHIVE}: scenario ${id} needs exactly ${scenario.samples} distinct samples for median comparison.`);
      invalidScenarios.add(id);
    }
    if (!first.buildId || observations.some((entry) => entry.buildId !== first.buildId || entry.backend !== first.backend || !samePerformanceContext(entry.context, first.context))) {
      result.problems.push(`${SCENARIO_ARCHIVE}: scenario ${id} mixes build, backend or measurement context, or has no build identity.`);
      invalidScenarios.add(id);
    }
    const sorted = observations.map((entry) => entry.measuredMs).sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    const [lower, upper] = sorted.length % 2 ? [sorted[midpoint], sorted[midpoint]] : [sorted[midpoint - 1], sorted[midpoint]];
    if (lower === undefined || upper === undefined) {
      result.problems.push(`${SCENARIO_ARCHIVE}: scenario ${id} has no samples for median comparison.`);
      invalidScenarios.add(id);
      continue;
    }
    const measuredMs = (lower + upper) / 2;
    const comparison: BaselineComparison = invalidScenarios.has(id)
      ? { status: "unverified", measuredMs, reason: "the complete sample set did not pass validation, correctness and every hard deadline" }
      : compareToBaseline({
        measuredMs,
        baseline: findBaseline({ baselines, scenarioId: id, scenarioVersion: scenario.version, profile: scenario.profile, backend: first.backend, context: first.context }),
        tolerance: baselines.tolerance,
        measurementVersion: baselines.measurementVersion === MEASUREMENT_VERSION ? first.measurementVersion : baselines.measurementVersion,
      });
    result.comparisons.push({ scenarioId: id, sample: null, basis: "median", samples: observations,
      measuredMs, budgetMs: scenario.budgetMs,
      correctness: observations.every((entry) => entry.status === "visible" && entry.correctness === "observed") ? "observed" : "unconfirmed",
      responsiveness: observations.every((entry) => entry.measuredMs <= scenario.budgetMs && entry.responsiveness === "within_target") ? "within_target" : "unconfirmed",
      comparison });
    if (comparison.status === "regressed") {
      result.problems.push(`${SCENARIO_ARCHIVE} (${id} median): regressed to ${measuredMs}ms against the reviewed ${comparison.referenceMs}ms baseline (limit ${Math.round(comparison.limitMs)}ms).`);
    } else if (comparison.status === "unverified" && scenario.comparison === "required") {
      result.problems.push(`${SCENARIO_ARCHIVE} (${id} median): comparison is unverified (${comparison.reason}); a required scenario cannot pass without a reviewed baseline and valid samples.`);
    }
  }
  for (const id of required) {
    const scenario = scenarios.find((entry) => entry.id === id);
    if (!scenario) { result.problems.push(`Unknown required scenario ${id}.`); continue; }
    const seen = samplesSeen.get(id)?.size ?? 0;
    if (seen !== scenario.samples) result.problems.push(`${SCENARIO_ARCHIVE}: required scenario ${id} recorded ${seen} of ${scenario.samples} samples.`);
  }
}
