// Rule test: a carried-over lab reference re-keys exactly one recorded reference to the current digest.
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

import carryoverFile from './lab-count-reference-carryover.json';
import referenceFile from './lab-count-references.json';
import {
  carryOverLabReferences,
  labCarryoverSchema,
  labReferenceProblems,
  labReferencesSchema,
  type LabReferences,
  type LabStepReference,
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

test('carry-over re-keys only the matching step and digest, keeps every reviewed value and records the entry', () => {
  const context = {
    measurementDigest: 'a'.repeat(64),
    workloadDigest: 'b'.repeat(64),
    browser: 'chromium',
    browserVersion: '140',
    viewport: { width: 375, height: 812 },
    cpuThrottle: 4 as const,
    role: 'employee' as const,
    backend: 'local' as const,
  };
  const counts = { requests: { reference: 4, tolerance: 0 } };
  const step: LabStepReference = {
    stepId: 'lab.field.clock-in',
    stepVersion: 1,
    labMeasurementVersion: 1,
    context,
    counts,
    payloads: {},
    source: { runKeys: ['r1'], buildId: 'build' },
    history: [{ kind: 'initial', runKeys: ['r1'], reason: 'five runs', context, counts, payloads: {} }],
  };
  const references: LabReferences = {
    version: 2,
    steps: [step, { ...step, stepId: 'lab.field.clock-out' }],
    gatedMetrics: [{ metric: 'requests', stability: 's', relevance: 'r', runKeys: ['r1'] }],
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
    context: { ...context, measurementDigest: 'c'.repeat(64) },
    history: [
      ...step.history,
      { kind: 'carry-over', fromDigest: 'a'.repeat(64), toDigest: 'c'.repeat(64), reason: 'r' },
    ],
  });
  expect(carried.steps[1]).toEqual({ ...step, stepId: 'lab.field.clock-out' });
  const steps = [getLabStep('lab.field.clock-in'), getLabStep('lab.field.clock-out')];
  expect(labReferenceProblems(carried, steps)).toEqual([]);
  // A digest moved by hand, without the carry-over entry, does not replay.
  const moved = { ...step, context: { ...context, measurementDigest: 'c'.repeat(64) } };
  expect(labReferenceProblems({ ...references, steps: [moved] }, steps)).toEqual([
    `lab.field.clock-in: context.measurementDigest is "${'c'.repeat(64)}", but its history replays "${'a'.repeat(64)}"`,
  ]);
});
