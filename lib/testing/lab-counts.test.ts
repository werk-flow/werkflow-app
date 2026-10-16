import { describe, expect, test } from 'bun:test';

import {
  acceptLabChange,
  byteTolerance,
  carryOverLabReferences,
  compareLabStep,
  countTolerance,
  formatLabTable,
  gateLabMetric,
  initialLabReference,
  isFailingRow,
  labReferenceProblems,
  legacyLabReferencesSchema,
  migrateLabReferences,
  ratchetLabReference,
  rejectLabMetric,
  ungateLabMetric,
  type LabReferences,
  type LabStepReference,
} from './lab-counts';
import { LAB_MEASUREMENT_VERSION, type LabObservation } from './lab-record';
import { LAB_METRICS, type LabMetric, type LabStep } from './lab-steps';

const STEP: LabStep = {
  id: 'lab.field.checklist-tick',
  version: 1,
  journey: 'field.checklist.tick',
  role: 'employee',
  file: 'tests/audit/lab/field.spec.ts',
  kind: 'mutation',
  viewport: { width: 375, height: 812 },
  cpuThrottle: 4,
  budgets: { routeRenders: 1 },
  comparison: 'required',
  description: 'test step',
};

const CONTEXT = {
  measurementDigest: 'a'.repeat(64),
  workloadDigest: 'b'.repeat(64),
  browser: 'chromium',
  browserVersion: '140.0',
  viewport: { width: 375, height: 812 },
  cpuThrottle: 4 as const,
  role: 'employee' as const,
  backend: 'local' as const,
};

function counts(overrides: Partial<Record<LabMetric, number>>): Record<LabMetric, number> {
  const base: Record<LabMetric, number> = {
    requests: 3,
    routeRenders: 1,
    echoRenders: 0,
    actionRoundTrips: 1,
    backgroundReads: 0,
    prefetches: 0,
    backendRequests: 4,
    reactCommits: 5,
    componentRenders: 40,
    domMutations: 20,
    layoutCount: 2,
    recalcStyleCount: 3,
    longTasks: 0,
    longAnimationFrames: 0,
  };
  return { ...base, ...overrides };
}

function observation(
  input: { counts?: Partial<Record<LabMetric, number>>; bytes?: number; shape?: string } = {},
): LabObservation {
  return {
    stepId: STEP.id,
    stepVersion: 1,
    labMeasurementVersion: LAB_MEASUREMENT_VERSION,
    buildId: 'build',
    context: CONTEXT,
    counts: counts(input.counts ?? {}),
    payloads: [
      {
        shape: input.shape ?? 'action:/auftraege/[jobNumber]',
        requests: 1,
        encodedBytes: 1_000,
        decodedBytes: input.bytes ?? 20_000,
        rows: null,
      },
    ],
    wallClockMs: 180,
    recordedAt: '2026-10-09T08:00:00.000Z',
  };
}

const FIVE_RUNS = ['r1', 'r2', 'r3', 'r4', 'r5'];
const REASON = 'five test runs on one build';

function reference(gated: LabMetric[] = ['requests', 'routeRenders']): LabStepReference {
  return initialLabReference({
    step: STEP,
    observations: FIVE_RUNS.map(() => observation()),
    runKeys: FIVE_RUNS,
    buildId: 'build',
    gated,
    reason: REASON,
  }).reference;
}

function rowOf(rows: ReturnType<typeof compareLabStep>, target: string) {
  const row = rows.find((candidate) => candidate.target === target);
  if (!row) throw new Error(`no row ${target}`);
  return row;
}

describe('lab counts', () => {
  test('every metric is listed once', () => {
    expect(new Set(LAB_METRICS).size).toBe(LAB_METRICS.length);
  });

  test('a count above its reference fails; one below it waits for the ratchet, which fails in release mode only', () => {
    const higher = compareLabStep({
      step: STEP,
      observation: observation({ counts: { requests: 4 } }),
      reference: reference(),
    });
    expect(rowOf(higher, 'requests').status).toBe('regressed');
    const lower = compareLabStep({
      step: STEP,
      observation: observation({ counts: { requests: 2 } }),
      reference: reference(),
    });
    const pending = rowOf(lower, 'requests');
    expect(pending.status).toBe('ratchet-pending');
    expect(isFailingRow(pending, false)).toBe(false);
    expect(isFailingRow(pending, true)).toBe(true);
  });

  test('a count above the absolute budget fails even when the metric has no reference', () => {
    const rows = compareLabStep({
      step: STEP,
      observation: observation({ counts: { routeRenders: 2 } }),
      reference: reference(['requests']),
    });
    expect(rowOf(rows, 'routeRenders').status).toBe('budget-exceeded');
  });

  test('an ungated metric prints and never fails', () => {
    const rows = compareLabStep({
      step: STEP,
      observation: observation({ counts: { domMutations: 900 } }),
      reference: reference(),
    });
    const row = rowOf(rows, 'domMutations');
    expect(row.status).toBe('ungated');
    expect(isFailingRow(row, true)).toBe(false);
  });

  test('a payload above its ceiling grew, one below its floor shrank, and an added or missing shape fails', () => {
    const base = reference();
    const target = 'action:/auftraege/[jobNumber]#decodedBytes';
    expect(
      rowOf(
        compareLabStep({ step: STEP, observation: observation({ bytes: 30_000 }), reference: base }),
        target,
      ).status,
    ).toBe('grew');
    expect(
      rowOf(
        compareLabStep({ step: STEP, observation: observation({ bytes: 10_000 }), reference: base }),
        target,
      ).status,
    ).toBe('shrank');
    const moved = compareLabStep({
      step: STEP,
      observation: observation({ shape: 'route:/auftraege/[jobNumber]' }),
      reference: base,
    });
    expect(moved.map((row) => row.status)).toContain('shape-added');
    expect(moved.map((row) => row.status)).toContain('shape-removed');
    expect(
      moved.filter((row) => row.status.startsWith('shape')).every((row) => isFailingRow(row, false)),
    ).toBe(true);
  });

  test('the ratchet only lowers counts and records each lowering', () => {
    const base = reference();
    const lowered = ratchetLabReference(base, observation({ counts: { requests: 2 } }), 'run-6');
    expect(lowered.counts.requests?.reference).toBe(2);
    expect(lowered.history.at(-1)).toEqual({
      kind: 'ratchet',
      target: 'requests',
      from: { reference: 3, tolerance: 0 },
      to: { reference: 2, tolerance: 0 },
      runKeys: ['run-6'],
      reason: null,
    });
    expect(
      ratchetLabReference(base, observation({ counts: { requests: 9 } }), 'run-7').counts.requests?.reference,
    ).toBe(3);
  });

  test('accepting a raise or a smaller payload needs a reason and records it', () => {
    const base = reference();
    const raise = {
      reference: base,
      observation: observation({ counts: { requests: 4 } }),
      target: 'requests',
      runKey: 'r',
    };
    expect(() => acceptLabChange({ ...raise, reason: ' ' })).toThrow();
    const raised = acceptLabChange({ ...raise, reason: 'a read the user needs' });
    expect(raised.counts.requests?.reference).toBe(4);
    expect(raised.history.at(-1)).toMatchObject({ kind: 'raise', reason: 'a read the user needs' });
    const smaller = acceptLabChange({
      reference: base,
      observation: observation({ bytes: 5_000 }),
      target: 'action:/auftraege/[jobNumber]',
      runKey: 'r',
      reason: 'server search',
    });
    expect(smaller.history.at(-1)?.kind).toBe('floor-accept');
    // A table row name such as `script#encodedBytes` is not a shape: refused, never a silent no-op entry.
    expect(() =>
      acceptLabChange({
        reference: base,
        observation: observation({ bytes: 5_000 }),
        target: 'action:/auftraege/[jobNumber]#decodedBytes',
        runKey: 'r',
        reason: 'typo',
      }),
    ).toThrow('neither a gated metric nor a request shape');
  });

  test('a reference needs five runs, and an unstable metric stays ungated', () => {
    expect(() =>
      initialLabReference({
        step: STEP,
        observations: [observation()],
        runKeys: ['r1'],
        buildId: 'b',
        gated: ['requests'],
        reason: REASON,
      }),
    ).toThrow();
    const noisy = initialLabReference({
      step: STEP,
      observations: [3, 3, 7, 3, 3].map((requests) => observation({ counts: { requests } })),
      runKeys: FIVE_RUNS,
      buildId: 'b',
      gated: ['requests', 'routeRenders'],
      reason: REASON,
    });
    expect(noisy.reference.counts.requests).toBeUndefined();
    expect(noisy.unstable[0]).toContain('requests');
  });

  test('a count may vary by one or 2 %, and one of ten or more keeps that much room; bytes by twice their relative spread, at least 1 %, plus 512 bytes', () => {
    expect(countTolerance([5, 5, 5])).toBe(0);
    expect(countTolerance([5, 6, 5])).toBe(1);
    expect(countTolerance([5, 8, 5])).toBeNull();
    expect(countTolerance([500, 508, 504])).toBe(10);
    expect(countTolerance([97, 97, 97])).toBe(1);
    expect(countTolerance([18, 18, 18])).toBe(1);
    expect(byteTolerance([10_000, 10_100, 10_050])).toEqual({ relative: 0.0199, absolute: 512 });
    expect(byteTolerance([10_000, 10_000])).toEqual({ relative: 0.01, absolute: 512 });
  });

  test('the committed references refuse a reference above its budget, an ungated reference and a raising ratchet', () => {
    const base = reference();
    const overBudget = {
      ...base.counts,
      routeRenders: { reference: 2, tolerance: 0 },
      domMutations: { reference: 1, tolerance: 0 },
    };
    const raisingRatchet: LabStepReference = {
      ...base,
      counts: { ...base.counts, requests: { reference: 4, tolerance: 0 } },
      history: [
        ...base.history,
        {
          kind: 'ratchet',
          target: 'requests',
          from: { reference: 3, tolerance: 0 },
          to: { reference: 4, tolerance: 0 },
          runKeys: ['r'],
          reason: null,
        },
      ],
    };
    const references: LabReferences = {
      version: 2,
      steps: [
        {
          ...base,
          counts: overBudget,
          history: [
            {
              kind: 'initial',
              runKeys: FIVE_RUNS,
              reason: REASON,
              context: base.context,
              counts: overBudget,
              payloads: base.payloads,
            },
          ],
        },
        { ...raisingRatchet, context: { ...base.context, measurementDigest: 'c'.repeat(64) } },
      ],
      gatedMetrics: [
        { metric: 'requests', stability: 's', relevance: 'r', runKeys: ['r'] },
        { metric: 'routeRenders', stability: 's', relevance: 'r', runKeys: ['r'] },
      ],
      rejectedMetrics: [],
    };
    const problems = labReferenceProblems(references, [STEP]);
    expect(problems.some((problem) => problem.includes('exceeds its budget'))).toBe(true);
    expect(problems.some((problem) => problem.includes('not a gated metric'))).toBe(true);
    expect(problems.some((problem) => problem.includes('raised'))).toBe(true);
  });

  test('the table shows absolute numbers first and the change as a signed number beside its percentage', () => {
    const rows = compareLabStep({
      step: STEP,
      observation: observation({ counts: { requests: 4 } }),
      reference: reference(),
    });
    const table = formatLabTable(STEP.id, rows, 180);
    expect(table[0]).toContain('180 ms');
    expect(table).toContain('  requests | 3 | 4 | +1 (+33.3 %) | 3 | 3 | regressed');
  });
});

describe('lab payload rules', () => {
  test('a prefetch shape, a shape request count and the encoded size of a text response print and never fail', () => {
    const base = initialLabReference({
      step: STEP,
      observations: FIVE_RUNS.map(() => observation({ shape: 'prefetch:/auftraege' })),
      runKeys: FIVE_RUNS,
      buildId: 'build',
      gated: ['requests'],
      reason: REASON,
    }).reference;
    const gone = compareLabStep({ step: STEP, observation: observation(), reference: base });
    expect(
      gone.filter((row) => row.target.startsWith('prefetch:')).every((row) => row.status === 'ungated'),
    ).toBe(true);
    const text = compareLabStep({ step: STEP, observation: observation(), reference: reference() });
    expect(text.find((row) => row.target.endsWith('#requests'))?.status).toBe('ungated');
    expect(text.find((row) => row.target.endsWith('#encodedBytes'))?.status).toBe('ungated');
  });
});

test('ungating removes one count from one step and records why', () => {
  const base = reference();
  const ungated = ungateLabMetric({
    reference: base,
    metric: 'requests',
    runKeys: ['r9'],
    reason: 'took 18 and 19',
  });
  expect(ungated.counts.requests).toBeUndefined();
  expect(ungated.counts.routeRenders).toEqual(base.counts.routeRenders);
  expect(ungated.history.at(-1)).toMatchObject({
    kind: 'ungate',
    target: 'requests',
    reason: 'took 18 and 19',
  });
  expect(() =>
    ungateLabMetric({ reference: base, metric: 'requests', runKeys: ['r9'], reason: ' ' }),
  ).toThrow();
});

test('a shape that only some runs carried is reported as unstable', () => {
  const runs = FIVE_RUNS.map((_, index) =>
    index === 4 ? observation({ shape: 'background:time-entries' }) : observation(),
  );
  const { unstable } = initialLabReference({
    step: STEP,
    observations: runs,
    runKeys: FIVE_RUNS,
    buildId: 'b',
    gated: ['requests'],
    reason: REASON,
  });
  expect(unstable.some((entry) => entry.startsWith('background:time-entries appeared in 1 of 5'))).toBe(true);
});

// Rule test: the reference history replays to the stored bounds, so a hand edit of the reference file fails.
describe('lab reference history', () => {
  const SHAPE = 'action:/auftraege/[jobNumber]';
  const GATED: LabReferences['gatedMetrics'] = [
    { metric: 'requests', stability: 's', relevance: 'r', runKeys: ['r1'] },
    { metric: 'routeRenders', stability: 's', relevance: 'r', runKeys: ['r1'] },
  ];
  const file = (...steps: LabStepReference[]): LabReferences => ({
    version: 2,
    steps,
    gatedMetrics: GATED,
    rejectedMetrics: [],
  });
  const problemsOf = (step: LabStepReference): string[] => labReferenceProblems(file(step), [STEP]);

  test('calibrate records every count and payload bound it sets in the initial entry', () => {
    const base = reference();
    expect(base.history).toEqual([
      {
        kind: 'initial',
        runKeys: FIVE_RUNS,
        reason: REASON,
        context: CONTEXT,
        counts: base.counts,
        payloads: base.payloads,
      },
    ]);
    expect(Object.keys(base.payloads)).toEqual([SHAPE]);
    expect(problemsOf(base)).toEqual([]);
  });

  test('ratchet, accept, ungate, reject, gate and carry-over each record the full bound they wrote, and the result replays', () => {
    let step = ratchetLabReference(reference(), observation({ counts: { requests: 2 } }), 'r6');
    step = acceptLabChange({
      reference: step,
      observation: observation({ counts: { requests: 3 } }),
      target: 'requests',
      runKey: 'r7',
      reason: 'a read the user needs',
    });
    step = acceptLabChange({
      reference: step,
      observation: observation({ bytes: 30_000 }),
      target: SHAPE,
      runKey: 'r8',
      reason: 'the detail carries the checklist',
    });
    step = acceptLabChange({
      reference: step,
      observation: observation({ shape: 'route:/auftraege' }),
      target: 'route:/auftraege',
      runKey: 'r9',
      reason: 'the save now refreshes the list',
    });
    step = ungateLabMetric({
      reference: step,
      metric: 'routeRenders',
      runKeys: ['r10'],
      reason: 'took 1 and 2',
    });
    let references = rejectLabMetric(file(step), {
      metric: 'requests',
      job: 'relevance',
      evidence: 'moved no waiting time',
      runKeys: ['r11'],
    });
    references = gateLabMetric(references, {
      metric: 'requests',
      stability: 's',
      relevance: 'r',
      runKeys: ['r12'],
    });
    references = carryOverLabReferences(references, {
      reason: 'carry-over',
      entries: [
        { stepId: STEP.id, fromDigest: 'a'.repeat(64), toDigest: 'd'.repeat(64), reason: 'a comment moved' },
      ],
    });
    const [written] = references.steps;
    expect(written?.history.map((entry) => entry.kind)).toEqual([
      'initial',
      'ratchet',
      'raise',
      'ceiling-accept',
      'shape-accept',
      'ungate',
      'reject',
      'carry-over',
    ]);
    expect(written?.history[2]).toEqual({
      kind: 'raise',
      target: 'requests',
      from: { reference: 2, tolerance: 0 },
      to: { reference: 3, tolerance: 0 },
      runKeys: ['r7'],
      reason: 'a read the user needs',
    });
    expect(written?.history[3]).toMatchObject({
      kind: 'ceiling-accept',
      target: SHAPE,
      from: reference().payloads[SHAPE],
      to: written?.payloads[SHAPE],
    });
    expect(written?.history[4]).toMatchObject({
      kind: 'shape-accept',
      from: null,
      to: written?.payloads['route:/auftraege'],
    });
    expect(written?.history[6]).toEqual({
      kind: 'reject',
      target: 'requests',
      from: { reference: 3, tolerance: 0 },
      to: null,
      runKeys: ['r11'],
      reason: 'moved no waiting time',
    });
    expect(written?.counts).toEqual({});
    expect(labReferenceProblems(references, [STEP])).toEqual([]);
  });

  test('the one-time migration snapshots the stored bounds and keeps the entries it replaced', () => {
    const base = reference();
    const superseded = [
      { kind: 'initial', target: '*', from: null, to: null, runKeys: FIVE_RUNS, reason: null },
      {
        kind: 'floor-accept',
        target: SHAPE,
        from: 30_000,
        to: 20_000,
        runKeys: ['r6'],
        reason: 'server search',
      },
    ];
    const legacy = legacyLabReferencesSchema.parse({
      version: 1,
      steps: [{ ...base, history: superseded }],
      gatedMetrics: GATED,
      rejectedMetrics: [],
    });
    const [legacyStep] = legacy.steps;
    if (!legacyStep) throw new Error('the legacy file lost its step');
    expect(JSON.stringify(legacyStep.history)).toBe(JSON.stringify(superseded));
    expect(() => migrateLabReferences(legacy, ' ')).toThrow();
    const migrated = migrateLabReferences(legacy, 'the bounds the last lab runs were judged against');
    expect(migrated.version).toBe(2);
    expect(migrated.steps[0]?.history).toEqual([
      {
        kind: 'migrated',
        runKeys: [...FIVE_RUNS, 'r6'],
        reason: 'the bounds the last lab runs were judged against',
        context: base.context,
        counts: base.counts,
        payloads: base.payloads,
        superseded: legacyStep.history,
      },
    ]);
    expect(labReferenceProblems(migrated, [STEP])).toEqual([]);
  });

  test('a raised count, a widened tolerance, a widened payload ceiling and a dropped entry are each named by step and field', () => {
    const base = ratchetLabReference(reference(), observation({ counts: { requests: 2 } }), 'r6');
    expect(problemsOf(base)).toEqual([]);
    const payload = base.payloads[SHAPE];
    if (!payload) throw new Error('the calibrated payload is missing');
    expect(
      problemsOf({ ...base, counts: { ...base.counts, requests: { reference: 5, tolerance: 0 } } }),
    ).toEqual([
      `${STEP.id}: counts.requests is {"reference":5,"tolerance":0}, but its history replays {"reference":2,"tolerance":0}`,
    ]);
    expect(
      problemsOf({ ...base, counts: { ...base.counts, routeRenders: { reference: 1, tolerance: 1 } } }),
    ).toEqual([
      `${STEP.id}: counts.routeRenders is {"reference":1,"tolerance":1}, but its history replays {"reference":1,"tolerance":0}`,
    ]);
    const widened = { reference: 20_000, tolerance: { relative: 0.5, absolute: 512 } };
    expect(problemsOf({ ...base, payloads: { [SHAPE]: { ...payload, decodedBytes: widened } } })).toEqual([
      `${STEP.id}: payloads.${SHAPE}.decodedBytes is ${JSON.stringify(widened)}, but its history replays ${JSON.stringify(payload.decodedBytes)}`,
    ]);
    expect(problemsOf({ ...base, history: base.history.slice(0, 1) })).toEqual([
      `${STEP.id}: counts.requests is {"reference":2,"tolerance":0}, but its history replays {"reference":3,"tolerance":0}`,
    ]);
    expect(problemsOf({ ...base, history: base.history.slice(1) })[0]).toBe(
      `${STEP.id}: the history does not open with an initial or migrated snapshot, so it cannot be replayed`,
    );
  });

  test('a forged ratchet that widens the tolerance and an entry that does not start from the replayed bound fail', () => {
    const base = reference();
    const widened = { reference: 3, tolerance: 2 };
    const forged: LabStepReference = {
      ...base,
      counts: { ...base.counts, requests: widened },
      history: [
        ...base.history,
        {
          kind: 'ratchet',
          target: 'requests',
          from: { reference: 3, tolerance: 0 },
          to: widened,
          runKeys: ['r6'],
          reason: null,
        },
      ],
    };
    expect(problemsOf(forged)).toEqual([
      `${STEP.id}: history[1] ratchet raised requests from {"reference":3,"tolerance":0} to {"reference":3,"tolerance":2}; a ratchet only lowers the reference`,
    ]);
    const detached: LabStepReference = {
      ...base,
      counts: { ...base.counts, requests: { reference: 9, tolerance: 0 } },
      history: [
        ...base.history,
        {
          kind: 'raise',
          target: 'requests',
          from: { reference: 7, tolerance: 0 },
          to: { reference: 9, tolerance: 0 },
          runKeys: ['r6'],
          reason: 'invented',
        },
      ],
    };
    expect(problemsOf(detached)[0]).toBe(
      `${STEP.id}: history[1] raise requests starts from {"reference":7,"tolerance":0}, but the history replays {"reference":3,"tolerance":0}`,
    );
  });
});
