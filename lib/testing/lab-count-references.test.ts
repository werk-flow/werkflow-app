// Rule test: every required lab step has a reviewed reference at the digest of its measured code.
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

import referenceFile from './lab-count-references.json';
import { labReferenceProblems, labReferencesSchema } from './lab-counts';
import { LAB_MEASUREMENT_VERSION } from './lab-record';
import { labMeasurementDigest } from './lab-count-context';
import { readLabReferences } from './lab-evidence';
import { LAB_STEPS } from './lab-steps';

const repositoryRoot = resolve(import.meta.dir, '../..');

test('the reference file has its shape and passes the structural rules', () => {
  const references = labReferencesSchema.parse(referenceFile);
  expect(labReferenceProblems(references, LAB_STEPS)).toEqual([]);
});

// A changed lab test or recorder module orphans its references; a required step
// without a reference at its current digest would fail the next release plan.
test('every required lab step has a reference at its current measurement digest', () => {
  const references = readLabReferences();
  const orphaned = LAB_STEPS.filter((step) => step.comparison === 'required')
    .filter(
      (step) =>
        !references.steps.some(
          (reference) =>
            reference.stepId === step.id &&
            reference.stepVersion === step.version &&
            reference.labMeasurementVersion === LAB_MEASUREMENT_VERSION &&
            reference.context.measurementDigest === labMeasurementDigest(repositoryRoot, step),
        ),
    )
    .map((step) => step.id);
  expect(orphaned).toEqual([]);
});

test('a gated metric carries its stability and relevance evidence, and a rejected one gates nothing', () => {
  const references = readLabReferences();
  for (const entry of references.gatedMetrics) {
    expect(entry.stability.trim().length).toBeGreaterThan(0);
    expect(entry.relevance.trim().length).toBeGreaterThan(0);
  }
  const rejected = new Set<string>(references.rejectedMetrics.map((entry) => entry.metric));
  const gatedRejected = references.steps.flatMap((step) =>
    Object.keys(step.counts)
      .filter((metric) => rejected.has(metric))
      .map((metric) => `${step.stepId}: ${metric}`),
  );
  expect(gatedRejected).toEqual([]);
});

test('every raise, accepted floor and accepted shape names a reason and a run', () => {
  const unexplained = readLabReferences().steps.flatMap((step) =>
    step.history
      .filter((entry) => entry.kind !== 'initial' && entry.kind !== 'ratchet')
      .filter((entry) => !entry.reason?.trim() || !entry.runKeys.length)
      .map((entry) => `${step.stepId}: ${entry.kind} ${entry.target}`),
  );
  expect(unexplained).toEqual([]);
});
