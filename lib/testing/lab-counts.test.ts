import { describe, expect, test } from 'bun:test';

import {
  acceptLabChange,
  byteTolerance,
  compareLabStep,
  countTolerance,
  formatLabTable,
  initialLabReference,
  isFailingRow,
  labReferenceProblems,
  ratchetLabReference,
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

function reference(gated: LabMetric[] = ['requests', 'routeRenders']): LabStepReference {
  return initialLabReference({
    step: STEP,
    observations: FIVE_RUNS.map(() => observation()),
    runKeys: FIVE_RUNS,
    buildId: 'build',
    gated,
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
    expect(lowered.history.at(-1)).toMatchObject({ kind: 'ratchet', target: 'requests', from: 3, to: 2 });
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
  });

  test('a reference needs five runs, and an unstable metric stays ungated', () => {
    expect(() =>
      initialLabReference({
        step: STEP,
        observations: [observation()],
        runKeys: ['r1'],
        buildId: 'b',
        gated: ['requests'],
      }),
    ).toThrow();
    const noisy = initialLabReference({
      step: STEP,
      observations: [3, 3, 7, 3, 3].map((requests) => observation({ counts: { requests } })),
      runKeys: FIVE_RUNS,
      buildId: 'b',
      gated: ['requests', 'routeRenders'],
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
    const references: LabReferences = {
      version: 1,
      steps: [
        {
          ...base,
          counts: {
            ...base.counts,
            routeRenders: { reference: 2, tolerance: 0 },
            domMutations: { reference: 1, tolerance: 0 },
          },
        },
        {
          ...base,
          context: { ...base.context, measurementDigest: 'c'.repeat(64) },
          history: [
            ...base.history,
            { kind: 'ratchet', target: 'requests', from: 2, to: 3, runKeys: ['r'], reason: null },
          ],
        },
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
  });
  expect(unstable.some((entry) => entry.startsWith('background:time-entries appeared in 1 of 5'))).toBe(true);
});
