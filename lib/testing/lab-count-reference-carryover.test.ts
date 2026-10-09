// Rule test: a carried-over lab reference re-keys exactly one recorded reference to the current digest.
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

import carryoverFile from './lab-count-reference-carryover.json';
import referenceFile from './lab-count-references.json';
import {
  carryOverLabReferences,
  labCarryoverSchema,
  labReferencesSchema,
  type LabReferences,
} from './lab-counts';
import { labMeasurementDigest } from './lab-count-context';
import { getLabStep } from './lab-steps';

const repositoryRoot = resolve(import.meta.dir, '../..');

test('every carry-over entry names a recorded reference and the current digest of its step', () => {
  const references = labReferencesSchema.parse(referenceFile);
  const problems = labCarryoverSchema.parse(carryoverFile).entries.flatMap((entry) => {
    const recorded = references.steps.some(
      (step) => step.stepId === entry.stepId && step.context.measurementDigest === entry.fromDigest,
    );
    if (!recorded) return [`${entry.stepId}: no reference at ${entry.fromDigest}; delete the stale entry`];
    return entry.toDigest === labMeasurementDigest(repositoryRoot, getLabStep(entry.stepId))
      ? []
      : [`${entry.stepId}: ${entry.toDigest} is not the step's current digest`];
  });
  expect(problems).toEqual([]);
});

test('carry-over re-keys only the matching step and digest and keeps every reviewed value', () => {
  const step = {
    stepId: 'lab.field.clock-in',
    stepVersion: 1,
    labMeasurementVersion: 1,
    context: {
      measurementDigest: 'a'.repeat(64),
      workloadDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '140',
      viewport: { width: 375, height: 812 },
      cpuThrottle: 4 as const,
      role: 'employee' as const,
      backend: 'local' as const,
    },
    counts: { requests: { reference: 4, tolerance: 0 } },
    payloads: {},
    source: { runKeys: ['r1'], buildId: 'build' },
    history: [{ kind: 'initial' as const, target: '*', from: null, to: null, runKeys: ['r1'], reason: null }],
  };
  const references: LabReferences = {
    version: 1,
    steps: [step, { ...step, stepId: 'lab.field.clock-out' }],
    gatedMetrics: [],
    rejectedMetrics: [],
  };
  const carried = carryOverLabReferences(references, {
    reason: 'a recorder comment moved',
    entries: [
      { stepId: 'lab.field.clock-in', fromDigest: 'a'.repeat(64), toDigest: 'c'.repeat(64), reason: 'r' },
    ],
  });
  expect(carried.steps[0]).toEqual({
    ...step,
    context: { ...step.context, measurementDigest: 'c'.repeat(64) },
  });
  expect(carried.steps[1]).toEqual({ ...step, stepId: 'lab.field.clock-out' });
});
