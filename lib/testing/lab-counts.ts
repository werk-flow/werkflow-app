import { z } from 'zod';

import {
  byteToleranceSchema,
  labCountsSchema,
  labHistoryEntrySchema,
  labPayloadsSchema,
  legacyHistoryEntrySchema,
  replayProblems,
  type CountReference,
  type LabHistoryEntry,
  type PayloadReference,
} from './lab-history';
import {
  labContextSchema,
  labMetricSchema as metricSchema,
  LAB_MEASUREMENT_VERSION,
  type LabObservation,
  type LabPayload,
} from './lab-record';
import { LAB_METRICS, type LabMetric, type LabStep } from './lab-steps';

type LabContext = z.infer<typeof labContextSchema>;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * Lab counts (docs/technical/performance.md): the reviewed references and the pure rules that compare, ratchet, accept
 * and judge stability. Only scripts/lab-counts.ts writes the reference file,
 * through these functions. Each function records the full bounds it wrote in
 * the step's history, which `labReferenceProblems` replays (lib/testing/lab-history.ts).
 */

const labStepReferenceFields = {
  stepId: z.string().min(1),
  stepVersion: z.number().int().positive(),
  labMeasurementVersion: z.number().int().positive(),
  context: labContextSchema,
  counts: labCountsSchema,
  payloads: labPayloadsSchema,
  source: z.object({ runKeys: z.array(z.string().min(1)).min(1), buildId: z.string().min(1) }).strict(),
};
const labStepReferenceSchema = z
  .object({ ...labStepReferenceFields, history: z.array(labHistoryEntrySchema).min(1) })
  .strict();
export type LabStepReference = z.infer<typeof labStepReferenceSchema>;

/** A metric that failed the stability or the relevance job; recorded, printed, never gated. */
const rejectedMetricSchema = z
  .object({
    metric: metricSchema,
    job: z.enum(['stability', 'relevance']),
    evidence: z.string().min(1),
    runKeys: z.array(z.string().min(1)).min(1),
  })
  .strict();

/** The two jobs of a gated metric, with the experiment that showed it tracks what the user waits for. */
const metricEvidenceSchema = z
  .object({
    metric: metricSchema,
    stability: z.string().min(1),
    relevance: z.string().min(1),
    runKeys: z.array(z.string().min(1)).min(1),
  })
  .strict();

/** Version 2: every history entry records the full bounds it wrote, so the history replays to the stored bounds. */
export const labReferencesSchema = z
  .object({
    version: z.literal(2),
    steps: z.array(labStepReferenceSchema),
    gatedMetrics: z.array(metricEvidenceSchema),
    rejectedMetrics: z.array(rejectedMetricSchema),
  })
  .strict();
export type LabReferences = z.infer<typeof labReferencesSchema>;

/** Version 1 of the file, whose history recorded no values; read only by `migrateLabReferences`. */
export const legacyLabReferencesSchema = z
  .object({
    version: z.literal(1),
    steps: z.array(
      z.object({ ...labStepReferenceFields, history: z.array(legacyHistoryEntrySchema).min(1) }).strict(),
    ),
    gatedMetrics: z.array(metricEvidenceSchema),
    rejectedMetrics: z.array(rejectedMetricSchema),
  })
  .strict();

/**
 * Makes a version 1 file replayable once: each step's history becomes one
 * `migrated` snapshot of its stored bounds, which keeps the replaced entries.
 * The stored bounds are the ones the last lab runs were judged against.
 */
export function migrateLabReferences(
  legacy: z.infer<typeof legacyLabReferencesSchema>,
  reason: string,
): LabReferences {
  if (!reason.trim())
    throw new Error('Migrating the lab history needs the reason its values are the reviewed ones.');
  return {
    ...legacy,
    version: 2,
    steps: legacy.steps.map((step) => ({
      ...step,
      history: [
        {
          kind: 'migrated',
          runKeys: [...new Set([...step.source.runKeys, ...step.history.flatMap((entry) => entry.runKeys)])],
          reason,
          context: step.context,
          counts: step.counts,
          payloads: step.payloads,
          superseded: step.history,
        },
      ],
    })),
  };
}

/** Re-keys one reference to a new measurement digest; the same rule as the wall-clock references. */
export const labCarryoverSchema = z
  .object({
    reason: z.string().min(1),
    entries: z.array(
      z
        .object({
          stepId: z.string().min(1),
          fromDigest: sha256,
          toDigest: sha256,
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export type LabCarryover = z.infer<typeof labCarryoverSchema>;

/** Re-keys each step a carry-over entry names, and records the entry in the step's history. */
export function carryOverLabReferences(references: LabReferences, carryover: LabCarryover): LabReferences {
  return {
    ...references,
    steps: references.steps.map((step) => {
      const entry = carryover.entries.find(
        (candidate) =>
          candidate.stepId === step.stepId && candidate.fromDigest === step.context.measurementDigest,
      );
      if (!entry) return step;
      return {
        ...step,
        context: { ...step.context, measurementDigest: entry.toDigest },
        history: [
          ...step.history,
          {
            kind: 'carry-over',
            fromDigest: entry.fromDigest,
            toDigest: entry.toDigest,
            reason: entry.reason,
          },
        ],
      };
    }),
  };
}

function sameLabContext(left: LabContext, right: LabContext): boolean {
  return JSON.stringify(labContextSchema.parse(left)) === JSON.stringify(labContextSchema.parse(right));
}

export function findLabReference(
  references: LabReferences,
  observation: LabObservation,
): LabStepReference | undefined {
  return references.steps.find(
    (reference) =>
      reference.stepId === observation.stepId &&
      reference.stepVersion === observation.stepVersion &&
      reference.labMeasurementVersion === observation.labMeasurementVersion &&
      sameLabContext(reference.context, observation.context),
  );
}

type LabRowStatus =
  | 'within'
  | 'regressed'
  | 'budget-exceeded'
  | 'ratchet-pending'
  | 'grew'
  | 'shrank'
  | 'shape-added'
  | 'shape-removed'
  | 'measurement-missing'
  | 'ungated';

export type LabRow = {
  target: string;
  reference: number | null;
  now: number | null;
  ceiling: number | null;
  floor: number | null;
  status: LabRowStatus;
};

type ByteReference = PayloadReference['encodedBytes'];

function byteBounds(reference: ByteReference): { ceiling: number; floor: number } {
  const { relative, absolute } = reference.tolerance;
  return {
    ceiling: Math.ceil(Math.max(reference.reference * (1 + relative), reference.reference + absolute)),
    floor: Math.max(
      0,
      Math.floor(Math.min(reference.reference * (1 - relative), reference.reference - absolute)),
    ),
  };
}

function countRow(
  target: string,
  measured: number,
  reference: CountReference,
  budget: number | undefined,
): LabRow {
  const ceiling = reference.reference + reference.tolerance;
  const floor = Math.max(0, reference.reference - reference.tolerance);
  const status: LabRowStatus =
    budget !== undefined && measured > budget
      ? 'budget-exceeded'
      : measured > ceiling
        ? 'regressed'
        : measured < floor
          ? 'ratchet-pending'
          : 'within';
  return { target, reference: reference.reference, now: measured, ceiling, floor, status };
}

// A bound whose observation is missing fails: the recorder writes null when it could
// not read the body, and a missing measurement must never read as within its bounds.
function missingRow(target: string, bound: number, informational: boolean): LabRow {
  return {
    target,
    reference: bound,
    now: null,
    ceiling: null,
    floor: null,
    status: informational ? 'ungated' : 'measurement-missing',
  };
}

/** The encoded and decoded byte rows of one shape that has a reference. */
function byteRows(
  shape: string,
  observed: LabPayload,
  reference: PayloadReference,
  ungated: boolean,
): LabRow[] {
  const rows: LabRow[] = [];
  const bytes: [string, number | null, ByteReference | null, boolean][] = [
    [
      'encodedBytes',
      observed.encodedBytes,
      reference.encodedBytes,
      ungated || reference.decodedBytes !== null,
    ],
    ['decodedBytes', observed.decodedBytes, reference.decodedBytes, ungated],
  ];
  for (const [field, now, bound, informational] of bytes) {
    if (!bound) continue;
    if (now === null) {
      rows.push(missingRow(`${shape}#${field}`, bound.reference, informational));
      continue;
    }
    const { ceiling, floor } = byteBounds(bound);
    const status: LabRowStatus = informational
      ? 'ungated'
      : now > ceiling
        ? 'grew'
        : now < floor
          ? 'shrank'
          : 'within';
    rows.push({ target: `${shape}#${field}`, reference: bound.reference, now, ceiling, floor, status });
  }
  return rows;
}

function payloadRows(
  observed: LabPayload | undefined,
  shape: string,
  reference: PayloadReference | undefined,
): LabRow[] {
  // A prefetch is timing-dependent and fewer is not better (the rejected `prefetches`
  // metric): its shapes print and never fail.
  const ungated = shape.startsWith('prefetch:');
  if (!reference && observed)
    return [
      {
        target: shape,
        reference: null,
        now: observed.encodedBytes,
        ceiling: null,
        floor: null,
        status: ungated ? 'ungated' : 'shape-added',
      },
    ];
  if (reference && !observed)
    return [
      {
        target: shape,
        reference: reference.encodedBytes.reference,
        now: null,
        ceiling: null,
        floor: null,
        status: ungated ? 'ungated' : 'shape-removed',
      },
    ];
  if (!reference || !observed) return [];
  // The request count of one shape follows the timing of echoes and supersed reads;
  // the step's `requests` count gates the total. Encoded bytes of a streamed text
  // response follow its compression chunks; the decoded bytes are its budget.
  const rows: LabRow[] = [
    {
      target: `${shape}#requests`,
      reference: reference.requests.reference,
      now: observed.requests,
      ceiling: null,
      floor: null,
      status: 'ungated',
    },
  ];
  rows.push(...byteRows(shape, observed, reference, ungated));
  if (reference.rows && observed.rows === null)
    rows.push(missingRow(`${shape}#rows`, reference.rows.reference, ungated));
  else if (reference.rows && observed.rows !== null) {
    const row = countRow(`${shape}#rows`, observed.rows, reference.rows, undefined);
    rows.push(
      row.status === 'ratchet-pending'
        ? { ...row, status: 'shrank' }
        : row.status === 'regressed'
          ? { ...row, status: 'grew' }
          : row,
    );
  }
  return rows;
}

/** Every row of one step run: the gated counts, every payload shape, and the ungated counts for information. */
export function compareLabStep(input: {
  step: LabStep;
  observation: LabObservation;
  reference: LabStepReference;
}): LabRow[] {
  const { step, observation, reference } = input;
  const rows: LabRow[] = LAB_METRICS.map((metric) => {
    const measured = observation.counts[metric];
    const bound = reference.counts[metric];
    const budget = step.budgets[metric];
    if (bound) return countRow(metric, measured, bound, budget);
    return {
      target: metric,
      reference: null,
      now: measured,
      ceiling: budget ?? null,
      floor: null,
      status: budget !== undefined && measured > budget ? 'budget-exceeded' : 'ungated',
    };
  });
  const shapes = [
    ...new Set([...observation.payloads.map((payload) => payload.shape), ...Object.keys(reference.payloads)]),
  ].sort();
  for (const shape of shapes)
    rows.push(
      ...payloadRows(
        observation.payloads.find((payload) => payload.shape === shape),
        shape,
        reference.payloads[shape],
      ),
    );
  return rows;
}

/** A row that fails when ceilings are enforced; `ratchet-pending` fails in release mode only. */
export function isFailingRow(row: LabRow, release: boolean): boolean {
  if (row.status === 'ratchet-pending') return release;
  return row.status !== 'within' && row.status !== 'ungated';
}

function signedChange(reference: number | null, now: number | null): string {
  if (reference === null || now === null) return '—';
  const change = now - reference;
  const sign = change > 0 ? '+' : '';
  const percent = reference === 0 ? '' : ` (${sign}${((change / reference) * 100).toFixed(1)} %)`;
  return `${sign}${change}${percent}`;
}

/** The table the author and the reviewer read: absolute numbers first, the percentage beside them. */
export function formatLabTable(stepId: string, rows: readonly LabRow[], wallClockMs: number): string[] {
  const show = (value: number | null): string => (value === null ? '—' : String(value));
  const lines = [
    `${stepId} (wall clock ${Math.round(wallClockMs)} ms, information only)`,
    '  metric | reference | now | change | ceiling | floor | status',
  ];
  for (const row of rows)
    lines.push(
      `  ${row.target} | ${show(row.reference)} | ${show(row.now)} | ${signedChange(row.reference, row.now)} | ${show(row.ceiling)} | ${show(row.floor)} | ${row.status}`,
    );
  return lines;
}

/** Lowers every gated count a passing run measured below its reference. Never raises, never touches payloads. */
export function ratchetLabReference(
  reference: LabStepReference,
  observation: LabObservation,
  runKey: string,
): LabStepReference {
  const counts = { ...reference.counts };
  const history = [...reference.history];
  for (const metric of LAB_METRICS) {
    const bound = counts[metric];
    const measured = observation.counts[metric];
    if (!bound || measured >= bound.reference - bound.tolerance) continue;
    const lowered = { ...bound, reference: measured };
    counts[metric] = lowered;
    history.push({
      kind: 'ratchet',
      target: metric,
      from: bound,
      to: lowered,
      runKeys: [runKey],
      reason: null,
    });
  }
  return { ...reference, counts, history };
}

export type StabilityRow = {
  target: string;
  min: number;
  max: number;
  median: number;
  /** The proposed tolerance, or null when the spread is too large to gate. */
  tolerance: number | null;
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted.length % 2 ? upper : (sorted[middle - 1] ?? upper);
  return Math.round((lower + upper) / 2);
}

/** A count may vary by at most one or 2 % of its value, whichever is larger; beyond that it is not gated. */
export function countTolerance(values: readonly number[]): number | null {
  const largest = Math.max(...values);
  const spread = largest - Math.min(...values);
  const allowed = Math.max(1, Math.floor(largest * 0.02));
  if (spread > allowed) return null;
  // A count of ten or more allows one more than its five runs showed: an echo that
  // lands one read later on a slower machine is not a regression.
  return largest >= 10 ? Math.max(spread, allowed) : spread;
}

/** Bytes: twice the observed relative spread, at least 1 %, plus 512 bytes. */
export function byteTolerance(values: readonly number[]): z.infer<typeof byteToleranceSchema> {
  const middle = median(values);
  const spread = Math.max(...values) - Math.min(...values);
  const relative = middle === 0 ? 0.01 : Math.max(0.01, Math.min(1, (2 * spread) / middle));
  return { relative: Number(relative.toFixed(4)), absolute: 512 };
}

export function stabilityOfCounts(observations: readonly LabObservation[]): StabilityRow[] {
  return LAB_METRICS.map((metric) => {
    const values = observations.map((observation) => observation.counts[metric]);
    return {
      target: metric,
      min: Math.min(...values),
      max: Math.max(...values),
      median: median(values),
      tolerance: countTolerance(values),
    };
  });
}

/**
 * The initial reference of one step from at least five runs on one build. A
 * metric enters only when it is gated (both jobs proven) and stable on this
 * step; a payload shape enters only when every run carried it.
 */
export function initialLabReference(input: {
  step: LabStep;
  observations: readonly LabObservation[];
  runKeys: readonly string[];
  buildId: string;
  gated: readonly LabMetric[];
  reason: string;
}): { reference: LabStepReference; unstable: string[] } {
  const { step, observations, runKeys, buildId, gated, reason } = input;
  if (!reason.trim()) throw new Error(`${step.id}: a calibration needs the basis the reviewer can check.`);
  const [first] = observations;
  if (!first || observations.length < 5)
    throw new Error(`${step.id}: a reference needs five runs on one build.`);
  if (observations.some((observation) => !sameLabContext(observation.context, first.context)))
    throw new Error(`${step.id}: the runs were measured in different contexts.`);
  const unstable: string[] = [];
  const counts: LabStepReference['counts'] = {};
  for (const row of stabilityOfCounts(observations)) {
    const metric = metricSchema.parse(row.target);
    if (!gated.includes(metric)) continue;
    if (row.tolerance === null) {
      unstable.push(`${metric} ${row.min}..${row.max}`);
      continue;
    }
    const budget = step.budgets[metric];
    if (budget !== undefined && row.max > budget)
      throw new Error(
        `${step.id}: ${metric} measured ${row.max}, above its budget ${budget}; fix the product first.`,
      );
    counts[metric] = { reference: row.min, tolerance: row.tolerance };
  }
  const payloads = initialPayloads(observations, unstable);
  return {
    unstable,
    reference: {
      stepId: step.id,
      stepVersion: step.version,
      labMeasurementVersion: LAB_MEASUREMENT_VERSION,
      context: first.context,
      counts,
      payloads,
      source: { runKeys: [...runKeys], buildId },
      history: [{ kind: 'initial', runKeys: [...runKeys], reason, context: first.context, counts, payloads }],
    },
  };
}

/** The payload bounds of a calibration; a shape some runs lacked or whose request count varied goes to `unstable`. */
function initialPayloads(
  observations: readonly LabObservation[],
  unstable: string[],
): LabStepReference['payloads'] {
  const payloads: LabStepReference['payloads'] = {};
  // Every shape any run carried: one missing from some runs is reported, never silently dropped.
  const shapes = new Set(
    observations.flatMap((observation) => observation.payloads.map((payload) => payload.shape)),
  );
  for (const shape of shapes) {
    const samples = observations.map((observation) =>
      observation.payloads.find((payload) => payload.shape === shape),
    );
    const present = samples.filter((sample): sample is LabPayload => sample !== undefined);
    if (present.length !== samples.length) {
      unstable.push(`${shape} appeared in ${present.length} of ${samples.length} runs`);
      continue;
    }
    const requests = present.map((sample) => sample.requests);
    const requestTolerance = countTolerance(requests);
    if (requestTolerance === null) {
      unstable.push(`${shape}#requests ${Math.min(...requests)}..${Math.max(...requests)}`);
      continue;
    }
    const encoded = present.map((sample) => sample.encodedBytes);
    const decoded = present.map((sample) => sample.decodedBytes);
    const rows = present.map((sample) => sample.rows);
    const decodedValues = decoded.filter((value): value is number => value !== null);
    const rowValues = rows.filter((value): value is number => value !== null);
    const rowTolerance = rowValues.length === rows.length ? countTolerance(rowValues) : null;
    payloads[shape] = {
      requests: { reference: Math.min(...requests), tolerance: requestTolerance },
      encodedBytes: { reference: median(encoded), tolerance: byteTolerance(encoded) },
      decodedBytes:
        decodedValues.length === decoded.length
          ? { reference: median(decodedValues), tolerance: byteTolerance(decodedValues) }
          : null,
      rows: rowTolerance === null ? null : { reference: Math.min(...rowValues), tolerance: rowTolerance },
    };
  }
  return payloads;
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

/** Records a metric's stability and relevance evidence. No step bound changes: `calibrate` adds the counts. */
export function gateLabMetric(
  references: LabReferences,
  evidence: z.infer<typeof metricEvidenceSchema>,
): LabReferences {
  return {
    ...references,
    gatedMetrics: [...references.gatedMetrics.filter((entry) => entry.metric !== evidence.metric), evidence],
    rejectedMetrics: references.rejectedMetrics.filter((entry) => entry.metric !== evidence.metric),
  };
}

/** Rejects a metric for every step: each step that gated it records the removed bound with the evidence. */
export function rejectLabMetric(
  references: LabReferences,
  rejection: z.infer<typeof rejectedMetricSchema>,
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

export function acceptLabChange(input: {
  reference: LabStepReference;
  observation: LabObservation;
  target: string;
  runKey: string;
  reason: string;
}): LabStepReference {
  const { reference, observation, target, runKey, reason } = input;
  if (!reason.trim()) throw new Error('Accepting a lab change needs a reason the reviewer can check.');
  const metric = metricSchema.safeParse(target);
  if (metric.success) {
    const bound = reference.counts[metric.data];
    if (!bound) throw new Error(`${reference.stepId}: ${target} is not gated on this step.`);
    const accepted = { ...bound, reference: observation.counts[metric.data] };
    const entry: LabHistoryEntry =
      accepted.reference > bound.reference
        ? { kind: 'raise', target: metric.data, from: bound, to: accepted, runKeys: [runKey], reason }
        : { kind: 'ratchet', target: metric.data, from: bound, to: accepted, runKeys: [runKey], reason };
    return {
      ...reference,
      counts: { ...reference.counts, [metric.data]: accepted },
      history: [...reference.history, entry],
    };
  }
  return acceptPayloadChange({ reference, observation, shape: target, runKey, reason });
}

/** The payload bound a run's observation sets, keeping the tolerances the shape already had. */
function acceptedPayload(observed: LabPayload, existing: PayloadReference | undefined): PayloadReference {
  return {
    requests: { reference: observed.requests, tolerance: existing?.requests.tolerance ?? 0 },
    encodedBytes: {
      reference: observed.encodedBytes,
      tolerance: existing?.encodedBytes.tolerance ?? { relative: 0.05, absolute: 512 },
    },
    decodedBytes:
      observed.decodedBytes === null
        ? null
        : {
            reference: observed.decodedBytes,
            tolerance: existing?.decodedBytes?.tolerance ?? { relative: 0.05, absolute: 512 },
          },
    rows:
      observed.rows === null ? null : { reference: observed.rows, tolerance: existing?.rows?.tolerance ?? 0 },
  };
}

function acceptPayloadChange(input: {
  reference: LabStepReference;
  observation: LabObservation;
  shape: string;
  runKey: string;
  reason: string;
}): LabStepReference {
  const { reference, observation, shape, runKey, reason } = input;
  const observed = observation.payloads.find((payload) => payload.shape === shape);
  const existing = reference.payloads[shape];
  // A target that is neither a gated metric nor a shape of the reference or the run is a typo
  // (`script#encodedBytes` names a table row, the shape is `script`): accepting it would record nothing.
  if (!observed && !existing)
    throw new Error(
      `${reference.stepId}: ${shape} is neither a gated metric nor a request shape of this step.`,
    );
  const accepted = observed ? acceptedPayload(observed, existing) : null;
  const payloads = { ...reference.payloads };
  if (accepted) payloads[shape] = accepted;
  else delete payloads[shape];
  const kind =
    !existing || !observed
      ? 'shape-accept'
      : (observed.decodedBytes ?? observed.encodedBytes) <
          (existing.decodedBytes?.reference ?? existing.encodedBytes.reference)
        ? 'floor-accept'
        : 'ceiling-accept';
  return {
    ...reference,
    payloads,
    history: [
      ...reference.history,
      { kind, target: shape, from: existing ?? null, to: accepted, runKeys: [runKey], reason },
    ],
  };
}

/**
 * Structural problems of the committed references that a schema cannot
 * express, and every difference between the stored bounds and the bounds the
 * history replays to (a hand edit).
 */
export function labReferenceProblems(references: LabReferences, steps: readonly LabStep[]): string[] {
  const problems: string[] = [];
  const gated = new Set(references.gatedMetrics.map((entry) => entry.metric));
  for (const rejected of references.rejectedMetrics)
    if (gated.has(rejected.metric)) problems.push(`${rejected.metric} is both gated and rejected`);
  const seen = new Set<string>();
  for (const reference of references.steps) {
    const key = `${reference.stepId}@${reference.stepVersion}/${reference.context.measurementDigest}`;
    if (seen.has(key)) problems.push(`duplicate reference ${key}`);
    seen.add(key);
    const step = steps.find((candidate) => candidate.id === reference.stepId);
    if (!step) {
      problems.push(`reference for unknown step ${reference.stepId}`);
      continue;
    }
    for (const metric of LAB_METRICS) {
      const bound = reference.counts[metric];
      if (!bound) continue;
      if (!gated.has(metric))
        problems.push(`${step.id}: ${metric} has a reference but is not a gated metric`);
      const budget = step.budgets[metric];
      if (budget !== undefined && bound.reference > budget)
        problems.push(`${step.id}: the ${metric} reference ${bound.reference} exceeds its budget ${budget}`);
    }
    for (const problem of replayProblems(reference)) problems.push(`${step.id}: ${problem}`);
  }
  return problems;
}
