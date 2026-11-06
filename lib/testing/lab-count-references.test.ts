// Rule test: every required lab step has a reviewed reference at the digest of its measured code.
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

import referenceFile from './lab-count-references.json';
import { labReferenceProblems, labReferencesSchema } from './lab-counts';
import { readLabReferences } from './lab-evidence';
import { LAB_STEPS } from './lab-steps';
import { labDigestProblems } from './reference-digests';

const repositoryRoot = resolve(import.meta.dir, '../..');

test('the reference file has its shape and passes the structural rules', () => {
  const references = labReferencesSchema.parse(referenceFile);
  expect(labReferenceProblems(references, LAB_STEPS)).toEqual([]);
});

// A changed lab test, recorder module or workload file orphans its references. Lab
// groups run nightly, so without this test the PR that moves a digest merges green.
test('every required lab step has a reference at its current measurement and workload digest', () => {
  const stored = labReferencesSchema.parse(referenceFile);
  const problems = labDigestProblems(repositoryRoot, { stored, carried: readLabReferences() }, LAB_STEPS);
  expect(problems, problems.join('\n')).toEqual([]);
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

test('every history entry but a lowering ratchet names its reason, and every entry from a run names the run', () => {
  const unexplained = readLabReferences().steps.flatMap((step) =>
    step.history
      .filter((entry) => entry.kind !== 'ratchet')
      .filter((entry) => !entry.reason.trim() || ('runKeys' in entry && !entry.runKeys.length))
      .map((entry) => `${step.stepId}: ${entry.kind}`),
  );
  expect(unexplained).toEqual([]);
});
