import { z } from "zod";

import baselineFile from "./performance-baselines.json";
import { MEASUREMENT_VERSION, MEASURED_SCENARIOS, type MeasuredScenario } from "./measured-scenarios";
import { performanceContextSchema, samePerformanceContext, type PerformanceContext } from "./performance-context";

/**
 * Reviewed performance baselines (Step 2). A baseline is the reference value
 * a later run of the same scenario, version, profile, and backend is compared
 * against. The comparison rule is frozen here, before any candidate is
 * evaluated: a run regresses when it exceeds the reference by both the
 * relative and the absolute tolerance, so clock noise on a fast scenario and
 * a small drift on a slow one are both ignored while a real slowdown is not.
 * Replacing a baseline needs a recorded reason; the newest slower run never
 * becomes the reference automatically.
 */

const APPROVED_PERFORMANCE_TOLERANCE = { relative: 0.25, absoluteMs: 250 } as const;

const baselineSchema = z.object({
  scenarioId: z.string().min(1),
  scenarioVersion: z.number().int().positive(),
  profile: z.enum(["golden-world", "typical"]),
  backend: z.enum(["local", "cloud"]),
  context: performanceContextSchema,
  referenceMs: z.number().finite().positive(),
  samples: z.array(z.number().finite().nonnegative()).min(3),
  source: z.object({
    runKey: z.string().min(1),
    runKeys: z.array(z.string().min(1)).min(1),
    buildId: z.string().min(1),
    recordedAt: z.string().datetime(),
  }),
  review: z.object({
    reason: z.string().min(1),
    reviewedAt: z.string().datetime(),
  }),
}).strict();

const performanceBaselinesSchema = z.object({
  version: z.literal(1),
  measurementVersion: z.number().int().positive(),
  tolerance: z.object({
    relative: z.number().min(0).max(1),
    absoluteMs: z.number().finite().nonnegative(),
  }).strict(),
  baselines: z.array(baselineSchema),
}).strict();

export type PerformanceBaseline = z.infer<typeof baselineSchema>;
export type PerformanceBaselines = z.infer<typeof performanceBaselinesSchema>;

export function readPerformanceBaselines(): PerformanceBaselines {
  const baselines = performanceBaselinesSchema.parse(baselineFile);
  const problems = validatePerformanceBaselines(baselines, MEASURED_SCENARIOS);
  if (problems.length) throw new Error(`Invalid performance baseline activation: ${problems.join("; ")}`);
  return baselines;
}

export function validatePerformanceBaselines(input: unknown, scenarios: readonly MeasuredScenario[]): string[] {
  const problems: string[] = [];
  const shape = performanceBaselinesSchema.safeParse(input);
  if (!shape.success) return [`Invalid baseline shape: ${shape.error.message}`];
  const baselines = shape.data;
  if (baselines.tolerance.relative !== APPROVED_PERFORMANCE_TOLERANCE.relative || baselines.tolerance.absoluteMs !== APPROVED_PERFORMANCE_TOLERANCE.absoluteMs) problems.push("Baseline tolerance must preserve the approved 25% and 250ms combined rule.");
  if (baselines.measurementVersion !== MEASUREMENT_VERSION) {
    problems.push(`Baselines were recorded with measurement version ${baselines.measurementVersion}; the current version is ${MEASUREMENT_VERSION}.`);
  }
  const seen = new Set<string>();
  for (const baseline of baselines.baselines) {
    const key = `${baseline.scenarioId}@${baseline.scenarioVersion}/${baseline.profile}/${baseline.backend}/${JSON.stringify(baseline.context)}`;
    if (seen.has(key)) problems.push(`Duplicate baseline: ${key}`);
    seen.add(key);
    const scenario = scenarios.find((entry) => entry.id === baseline.scenarioId);
    if (!scenario) problems.push(`Baseline for unknown scenario: ${baseline.scenarioId}`);
    else {
      if (scenario.version !== baseline.scenarioVersion) problems.push(`Baseline ${key} does not match scenario version ${scenario.version}.`);
      if (scenario.profile !== baseline.profile) problems.push(`Baseline ${key} does not match scenario profile ${scenario.profile}.`);
      if (baseline.referenceMs > scenario.budgetMs) problems.push(`Baseline ${key} reference ${baseline.referenceMs}ms exceeds the ${scenario.budgetMs}ms budget; a slow run cannot become the reference.`);
      if (baseline.samples.some((sample) => sample > scenario.budgetMs)) problems.push(`Baseline ${key} contains an over-budget sample.`);
    }
    const sorted = [...baseline.samples].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    const [lower, upper] = sorted.length % 2 ? [sorted[midpoint], sorted[midpoint]] : [sorted[midpoint - 1], sorted[midpoint]];
    if (lower === undefined || upper === undefined || baseline.referenceMs !== (lower + upper) / 2) problems.push(`Baseline ${key} reference must equal the retained sample median.`);
    if (new Set(baseline.source.runKeys).size !== baseline.source.runKeys.length || !baseline.source.runKeys.includes(baseline.source.runKey)) problems.push(`Baseline ${key} must retain unique source run keys including its primary run.`);
  }
  return problems;
}

export type BaselineComparison =
  | { status: "within" | "improved" | "regressed"; referenceMs: number; measuredMs: number; limitMs: number }
  | { status: "unverified"; measuredMs: number; reason: string };

export function findBaseline(input: {
  baselines: PerformanceBaselines;
  scenarioId: string;
  scenarioVersion: number;
  profile: string;
  backend: string;
  context: PerformanceContext;
}): PerformanceBaseline | undefined {
  return input.baselines.baselines.find((baseline) =>
    baseline.scenarioId === input.scenarioId && baseline.scenarioVersion === input.scenarioVersion &&
    baseline.profile === input.profile && baseline.backend === input.backend && samePerformanceContext(baseline.context, input.context));
}

/** Both tolerances must be exceeded for a regression; both must be beaten for an improvement. */
export function compareToBaseline(input: {
  measuredMs: number;
  baseline: PerformanceBaseline | undefined;
  tolerance: PerformanceBaselines["tolerance"];
  measurementVersion: number;
}): BaselineComparison {
  if (!input.baseline) return { status: "unverified", measuredMs: input.measuredMs, reason: "no reviewed baseline for this scenario, version, profile, and backend" };
  if (input.measurementVersion !== MEASUREMENT_VERSION) return { status: "unverified", measuredMs: input.measuredMs, reason: `measurement version ${input.measurementVersion} is not comparable with ${MEASUREMENT_VERSION}` };
  const reference = input.baseline.referenceMs;
  const limit = Math.max(reference * (1 + input.tolerance.relative), reference + input.tolerance.absoluteMs);
  const floor = Math.min(reference * (1 - input.tolerance.relative), reference - input.tolerance.absoluteMs);
  const status = input.measuredMs > limit ? "regressed" : input.measuredMs < floor ? "improved" : "within";
  return { status, referenceMs: reference, measuredMs: input.measuredMs, limitMs: limit };
}
