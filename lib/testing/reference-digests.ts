import { resolve } from 'node:path';

import { labMeasurementDigest, labWorkloadDigest } from './lab-count-context';
import type { LabReferences } from './lab-counts';
import { LAB_MEASUREMENT_VERSION } from './lab-record';
import type { LabStep } from './lab-steps';
import type { MeasuredScenario } from './measured-scenarios';
import type { PerformanceBaselines } from './performance-baselines';
import { measurementDigest, workloadDigest } from './performance-context';

/**
 * The static side of the reference digests (docs/technical/performance.md,
 * "Move a reference to a new digest"). A run hashes a workload's files with the
 * workload its seed archived. That archive repeats byte for byte, so the
 * repository keeps the reviewed copy and the unit suite derives the same digest
 * from the tree alone. A PR that moves a digest then fails on the PR, not in the
 * next nightly. The check reads no machine field of a reference, so its result
 * is the same on every machine.
 */
const REVIEWED_WORKLOAD_DIRECTORY = 'lib/testing/workload-archive';

const HOW_TO = 'See docs/technical/performance.md, "Move a reference to a new digest".';

const REPLACING = ', replacing any entry for the same reference';

/**
 * The reference file as stored, and with its carry-over entries applied. A run
 * judges the carried digest; a carry-over entry applies once, from the stored
 * digest, so a printed entry starts there.
 */
type Referenced<References> = { stored: References; carried: References };

const reviewedArchive = (repositoryRoot: string): string =>
  resolve(repositoryRoot, REVIEWED_WORKLOAD_DIRECTORY);

export function reviewedWorkloadDigest(repositoryRoot: string, scenario: MeasuredScenario): string {
  return workloadDigest(repositoryRoot, scenario, reviewedArchive(repositoryRoot));
}

type MovedWorkload = { id: string; fromDigest: string; toDigest: string };

/** One problem per digest move, because one command re-keys all of its rows. */
function workloadProblems(moved: readonly MovedWorkload[], ifItChanged: string): string[] {
  const moves = Map.groupBy(moved, (row) => `${row.fromDigest} ${row.toDigest}`);
  return [...moves.values()].flatMap((rows) => {
    const [row] = rows;
    if (!row) return [];
    return [
      `On workload digest ${row.fromDigest}, but this tree gives ${row.toDigest}: ${rows.map(({ id }) => id).join(', ')}. ` +
        `If the seeded workload did not change, re-key them, which needs no local stack and keeps every value: bun scripts/lab-counts.ts rekey-workload --from ${row.fromDigest} --reason "<why the seeded rows stay the same>". ` +
        `A wrong claim fails the next run that measures it. If the workload changed, ${ifItChanged}. ${HOW_TO}`,
    ];
  });
}

function measurementProblems(entries: readonly string[], advice: string): string[] {
  return entries.length ? [`${advice} ${HOW_TO}`, ...entries] : [];
}

/** Every required lab step that a run would find without a reference, with what to do about it. */
export function labDigestProblems(
  repositoryRoot: string,
  { stored, carried }: Referenced<LabReferences>,
  steps: readonly LabStep[],
): string[] {
  const toDigest = labWorkloadDigest(repositoryRoot, reviewedArchive(repositoryRoot));
  const measurement: string[] = [];
  const workload: MovedWorkload[] = [];
  for (const step of steps.filter((candidate) => candidate.comparison === 'required')) {
    const digest = labMeasurementDigest(repositoryRoot, step);
    const sameStep = (reference: LabReferences['steps'][number]): boolean =>
      reference.stepId === step.id &&
      reference.stepVersion === step.version &&
      reference.labMeasurementVersion === LAB_MEASUREMENT_VERSION;
    const current = carried.steps
      .filter(sameStep)
      .find((reference) => reference.context.measurementDigest === digest);
    if (current) {
      if (current.context.workloadDigest !== toDigest)
        workload.push({ id: step.id, fromDigest: current.context.workloadDigest, toDigest });
      continue;
    }
    const recorded = stored.steps.find(sameStep);
    measurement.push(
      recorded
        ? `${step.id}: its measured code moved. Carry-over entry: ${JSON.stringify({ stepId: step.id, fromDigest: recorded.context.measurementDigest, toDigest: digest, reason: '<why the counts stay the same>' })}`
        : `${step.id}: no reference at all; calibrate it or set its comparison to 'calibrating'.`,
    );
  }
  return [
    ...measurementProblems(
      measurement,
      `If the edit cannot change what is counted, put each entry below into lib/testing/lab-count-reference-carryover.json${REPLACING}. Otherwise recalibrate from five runs.`,
    ),
    ...workloadProblems(
      workload,
      `recalibrate from five runs and copy a run's performance-workload.json into ${REVIEWED_WORKLOAD_DIRECTORY}/; that takes a local stack, so without one hand the change over`,
    ),
  ];
}

/**
 * The same for the wall-clock references. A reference from any machine
 * satisfies its scenario, because only that machine can recalibrate it.
 */
export function wallClockDigestProblems(
  repositoryRoot: string,
  { stored, carried }: Referenced<PerformanceBaselines>,
  scenarios: readonly MeasuredScenario[],
): string[] {
  const measurement: string[] = [];
  const workload: MovedWorkload[] = [];
  for (const scenario of scenarios.filter((candidate) => candidate.comparison === 'required')) {
    const digest = measurementDigest(repositoryRoot, scenario);
    const toDigest = reviewedWorkloadDigest(repositoryRoot, scenario);
    const sameScenario = (baseline: PerformanceBaselines['baselines'][number]): boolean =>
      baseline.scenarioId === scenario.id && baseline.scenarioVersion === scenario.version;
    const current = carried.baselines
      .filter(sameScenario)
      .filter((baseline) => baseline.context.measurementDigest === digest);
    if (current.some((baseline) => baseline.context.workloadDigest === toDigest)) continue;
    const [sameCode] = current;
    if (sameCode) {
      workload.push({ id: scenario.id, fromDigest: sameCode.context.workloadDigest, toDigest });
      continue;
    }
    const recorded = stored.baselines.find(sameScenario);
    measurement.push(
      recorded
        ? `${scenario.id}: its measured code moved. Carry-over entry: ${JSON.stringify({ scenarioId: scenario.id, fileDigest: recorded.context.measurementDigest, measuredTestDigest: digest })}`
        : `${scenario.id}: no reference at all; calibrate it or set its comparison to 'calibrating'.`,
    );
  }
  const elsewhere = `recalibrate on the machine the reference names, or set the scenario's comparison to 'calibrating' until that machine does`;
  return [
    ...measurementProblems(
      measurement,
      `If the edit cannot change what a scenario measures, put each entry below into lib/testing/performance-reference-carryover.json${REPLACING}. Otherwise ${elsewhere}.`,
    ),
    ...workloadProblems(
      workload,
      `${elsewhere}, and copy a run's workload archive into ${REVIEWED_WORKLOAD_DIRECTORY}/`,
    ),
  ];
}

type WorkloadRekey = { fromDigest: string; reason: string };

/** Moves every lab reference on one workload digest to the tree's digest and records it in the history. */
export function rekeyLabWorkload(
  repositoryRoot: string,
  references: LabReferences,
  { fromDigest, reason }: WorkloadRekey,
): LabReferences {
  const toDigest = labWorkloadDigest(repositoryRoot, reviewedArchive(repositoryRoot));
  if (toDigest === fromDigest) return references;
  return {
    ...references,
    steps: references.steps.map((step) =>
      step.context.workloadDigest === fromDigest
        ? {
            ...step,
            context: { ...step.context, workloadDigest: toDigest },
            history: [...step.history, { kind: 'workload-carry-over', fromDigest, toDigest, reason }],
          }
        : step,
    ),
  };
}

/** The same for the wall-clock references. Only the key moves; the reference keeps its review and samples. */
export function rekeyWallClockWorkload(
  repositoryRoot: string,
  baselines: PerformanceBaselines,
  scenarios: readonly MeasuredScenario[],
  { fromDigest, reason }: WorkloadRekey,
): PerformanceBaselines {
  return {
    ...baselines,
    baselines: baselines.baselines.map((baseline) => {
      const scenario = scenarios.find((candidate) => candidate.id === baseline.scenarioId);
      if (!scenario || baseline.context.workloadDigest !== fromDigest) return baseline;
      const toDigest = reviewedWorkloadDigest(repositoryRoot, scenario);
      if (toDigest === fromDigest) return baseline;
      return {
        ...baseline,
        context: { ...baseline.context, workloadDigest: toDigest },
        workloadCarryOvers: [...(baseline.workloadCarryOvers ?? []), { fromDigest, toDigest, reason }],
      };
    }),
  };
}
