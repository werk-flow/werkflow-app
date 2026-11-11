import { ungatedInHistory, type KeptUngate, type LabHistoryEntry } from './lab-history';
import { initialLabReference, type LabReferences, type LabStepReference } from './lab-counts';
import { type LabMetric } from './lab-steps';

/**
 * Which counts gate a step (docs/technical/performance.md, "Change a lab
 * reference"): `gate` and `reject` for every step, `ungate` for one, and the
 * calibration that keeps a step's ungate until a gate that names the step.
 */

/**
 * Recalibrates one step: the new reference supersedes every earlier reference
 * of the step and keeps their ungates, because five runs cannot show a count
 * that takes its second value once in dozens.
 */
export function calibrateLabStep(
  references: LabReferences,
  input: Omit<Parameters<typeof initialLabReference>[0], 'gated' | 'ungated'>,
): { references: LabReferences; unstable: string[]; ungated: KeptUngate[] } {
  const earlier = references.steps.filter((candidate) => candidate.stepId === input.step.id);
  const ungated = [
    ...new Map(
      earlier.flatMap((step) => ungatedInHistory(step.history)).map((entry) => [entry.metric, entry]),
    ).values(),
  ];
  const { reference, unstable } = initialLabReference({
    ...input,
    gated: references.gatedMetrics.map((entry) => entry.metric),
    ungated,
  });
  return {
    references: {
      ...references,
      steps: [...references.steps.filter((step) => !earlier.includes(step)), reference],
    },
    unstable,
    ungated,
  };
}

/**
 * Removes one count from one step's reference when later runs showed it takes
 * two values on that step (an echo that sometimes coalesces). The metric stays
 * gated on the other steps; the reason and the runs go into the history.
 */
export function ungateLabMetric(input: {
  reference: LabStepReference;
  metric: LabMetric;
  runKeys: readonly string[];
  reason: string;
}): LabStepReference {
  const { reference, metric, runKeys, reason } = input;
  if (!reason.trim())
    throw new Error('Ungating a lab count needs the evidence that it is unstable on this step.');
  const bound = reference.counts[metric];
  if (!bound) throw new Error(`${reference.stepId}: ${metric} is not gated on this step.`);
  const counts = { ...reference.counts };
  delete counts[metric];
  return {
    ...reference,
    counts,
    history: [
      ...reference.history,
      { kind: 'ungate', target: metric, from: bound, to: null, runKeys: [...runKeys], reason },
    ],
  };
}

/**
 * Records a metric's stability and relevance evidence. No step bound changes:
 * `calibrate` adds the counts. A `stepId` also reverses that step's `ungate`,
 * which no gate without it touches.
 */
export function gateLabMetric(
  references: LabReferences,
  evidence: LabReferences['gatedMetrics'][number],
  stepId?: string,
): LabReferences {
  const { metric, stability, runKeys } = evidence;
  const reversed = references.steps.filter(
    (step) =>
      step.stepId === stepId && ungatedInHistory(step.history).some((entry) => entry.metric === metric),
  );
  if (stepId !== undefined && !reversed.length)
    throw new Error(`${stepId}: ${metric} is not ungated on this step.`);
  const entry: LabHistoryEntry = { kind: 'gate', target: metric, runKeys, reason: stability };
  return {
    ...references,
    gatedMetrics: [...references.gatedMetrics.filter((entry) => entry.metric !== metric), evidence],
    rejectedMetrics: references.rejectedMetrics.filter((entry) => entry.metric !== metric),
    steps: references.steps.map((step) =>
      reversed.includes(step) ? { ...step, history: [...step.history, entry] } : step,
    ),
  };
}

/** Rejects a metric for every step: each step that gated it records the removed bound with the evidence. */
export function rejectLabMetric(
  references: LabReferences,
  rejection: LabReferences['rejectedMetrics'][number],
): LabReferences {
  const { metric, evidence, runKeys } = rejection;
  return {
    ...references,
    gatedMetrics: references.gatedMetrics.filter((entry) => entry.metric !== metric),
    rejectedMetrics: [...references.rejectedMetrics.filter((entry) => entry.metric !== metric), rejection],
    steps: references.steps.map((step) => {
      const bound = step.counts[metric];
      if (!bound) return step;
      const counts = { ...step.counts };
      delete counts[metric];
      const entry: LabHistoryEntry = {
        kind: 'reject',
        target: metric,
        from: bound,
        to: null,
        runKeys,
        reason: evidence,
      };
      return { ...step, counts, history: [...step.history, entry] };
    }),
  };
}
