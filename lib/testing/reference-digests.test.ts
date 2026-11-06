// Rule test: a moved digest fails with the fix it needs, and a re-key moves only the key.
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'bun:test';

import { TYPICAL_PROFILE } from '../../tests/audit/support/performance-profile';
import { carryOverLabReferences, labCarryoverSchema, labReferenceProblems } from './lab-counts';
import { readLabReferences } from './lab-evidence';
import { LAB_STEPS } from './lab-steps';
import { MEASURED_SCENARIOS } from './measured-scenarios';
import {
  carryOverReferences,
  readPerformanceBaselines,
  referenceCarryoverSchema,
} from './performance-baselines';
import {
  labDigestProblems,
  rekeyLabWorkload,
  rekeyWallClockWorkload,
  reviewedWorkloadDigest,
  wallClockDigestProblems,
} from './reference-digests';
import archivedWorkload from './workload-archive/performance-workload.json';

const repositoryRoot = resolve(import.meta.dir, '../..');
const oldDigest = 'a'.repeat(64);
const typical = MEASURED_SCENARIOS.find((scenario) => scenario.profile === 'typical');
if (!typical) throw new Error('A typical-profile scenario is required.');
const typicalDigest = reviewedWorkloadDigest(repositoryRoot, typical);

const same = <References>(references: References) => ({ stored: references, carried: references });
const printedEntry = (line: string | undefined): unknown => JSON.parse((line ?? '').replace(/^.*?(?={)/, ''));

const labOnOldWorkload = () => {
  const references = readLabReferences();
  return {
    ...references,
    steps: references.steps.map((step) => ({
      ...step,
      context: { ...step.context, workloadDigest: oldDigest },
    })),
  };
};

const wallClockOnOldWorkload = () => {
  const baselines = readPerformanceBaselines();
  return {
    ...baselines,
    baselines: baselines.baselines.map((baseline) =>
      baseline.profile === 'typical'
        ? { ...baseline, context: { ...baseline.context, workloadDigest: oldDigest } }
        : baseline,
    ),
  };
};

// The definition is the one part of the archive the tree knows. A changed
// definition is a changed workload, so a re-key cannot hide it.
test('the reviewed archive holds the typical profile the tree seeds', () => {
  expect(archivedWorkload.definition).toEqual(TYPICAL_PROFILE);
});

test('a lab reference on a moved workload digest names the re-key and the recalibration', () => {
  const problems = labDigestProblems(repositoryRoot, same(labOnOldWorkload()), LAB_STEPS);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(`workload digest ${oldDigest}, but this tree gives ${typicalDigest}`);
  expect(problems[0]).toContain(`rekey-workload --from ${oldDigest}`);
  expect(problems[0]).toContain('needs no local stack');
  expect(problems[0]).toContain('recalibrate from five runs');
});

test('a wall-clock reference on a moved workload digest never demands another machine', () => {
  const problems = wallClockDigestProblems(
    repositoryRoot,
    same(wallClockOnOldWorkload()),
    MEASURED_SCENARIOS,
  );
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(`rekey-workload --from ${oldDigest}`);
  expect(problems[0]).toContain("set the scenario's comparison to 'calibrating'");
});

test('a reference from any machine satisfies its scenario', () => {
  const baselines = readPerformanceBaselines();
  const elsewhere = {
    ...baselines,
    baselines: baselines.baselines.map((baseline) => ({
      ...baseline,
      context: { ...baseline.context, platform: 'darwin', cpuModel: 'Apple M4', memoryGiB: 24 },
    })),
  };
  expect(wallClockDigestProblems(repositoryRoot, same(elsewhere), MEASURED_SCENARIOS)).toEqual([]);
});

test('a moved measurement digest prints the carry-over entry to add', () => {
  const references = readLabReferences();
  const [first, ...others] = references.steps;
  if (!first) throw new Error('The lab references are empty.');
  const moved = { ...first, context: { ...first.context, measurementDigest: oldDigest } };
  const lab = labDigestProblems(
    repositoryRoot,
    same({ ...references, steps: [moved, ...others] }),
    LAB_STEPS,
  );
  expect(lab[0]).toContain('lib/testing/lab-count-reference-carryover.json');
  expect(lab[1]).toContain(`"stepId":"${first.stepId}","fromDigest":"${oldDigest}"`);

  const baselines = readPerformanceBaselines();
  const [baseline, ...rest] = baselines.baselines;
  if (!baseline) throw new Error('The wall-clock references are empty.');
  const carried = { ...baseline, context: { ...baseline.context, measurementDigest: oldDigest } };
  const wallClock = wallClockDigestProblems(
    repositoryRoot,
    same({ ...baselines, baselines: [carried, ...rest] }),
    MEASURED_SCENARIOS,
  );
  expect(wallClock[0]).toContain('lib/testing/performance-reference-carryover.json');
  expect(wallClock[1]).toContain(`"scenarioId":"${baseline.scenarioId}","fileDigest":"${oldDigest}"`);
});

// The readers apply one entry, from the stored digest. An entry printed from the
// carried digest would change nothing, so a second edit could never pass.
test('after an earlier carry-over, the printed entry starts at the stored digest and clears the failure', () => {
  const carriedDigest = 'b'.repeat(64);
  const references = readLabReferences();
  const [first, ...others] = references.steps;
  if (!first) throw new Error('The lab references are empty.');
  const stored = {
    ...references,
    steps: [{ ...first, context: { ...first.context, measurementDigest: oldDigest } }, ...others],
  };
  const carried = carryOverLabReferences(stored, {
    reason: 'an earlier edit',
    entries: [{ stepId: first.stepId, fromDigest: oldDigest, toDigest: carriedDigest, reason: 'r' }],
  });
  const lab = labDigestProblems(repositoryRoot, { stored, carried }, LAB_STEPS);
  expect(lab[0]).toContain('replacing any entry for the same reference');
  const replaced = carryOverLabReferences(
    stored,
    labCarryoverSchema.parse({ reason: 'r', entries: [printedEntry(lab[1])] }),
  );
  expect(labDigestProblems(repositoryRoot, same(replaced), LAB_STEPS)).toEqual([]);

  const baselines = readPerformanceBaselines();
  const [baseline, ...rest] = baselines.baselines;
  if (!baseline) throw new Error('The wall-clock references are empty.');
  const storedBaselines = {
    ...baselines,
    baselines: [{ ...baseline, context: { ...baseline.context, measurementDigest: oldDigest } }, ...rest],
  };
  const carriedBaselines = carryOverReferences(storedBaselines, {
    reason: 'an earlier edit',
    entries: [{ scenarioId: baseline.scenarioId, fileDigest: oldDigest, measuredTestDigest: carriedDigest }],
  });
  const wallClock = wallClockDigestProblems(
    repositoryRoot,
    { stored: storedBaselines, carried: carriedBaselines },
    MEASURED_SCENARIOS,
  );
  const replacedBaselines = carryOverReferences(
    storedBaselines,
    referenceCarryoverSchema.parse({ reason: 'r', entries: [printedEntry(wallClock[1])] }),
  );
  expect(wallClockDigestProblems(repositoryRoot, same(replacedBaselines), MEASURED_SCENARIOS)).toEqual([]);
});

test('a required step without any reference says so', () => {
  const references = { ...readLabReferences(), steps: [] };
  expect(labDigestProblems(repositoryRoot, same(references), LAB_STEPS).join()).toContain(
    'no reference at all',
  );
});

test('a lab re-key changes only the workload key, and the history still replays', () => {
  const stale = labOnOldWorkload();
  const change = { fromDigest: oldDigest, reason: 'a type-only edit' };
  const rekeyed = rekeyLabWorkload(repositoryRoot, stale, change);
  rekeyed.steps.forEach((step, index) => {
    const before = stale.steps[index];
    if (!before) throw new Error(`No step at ${index}.`);
    expect(step.counts).toEqual(before.counts);
    expect(step.payloads).toEqual(before.payloads);
    expect({ ...step.context, workloadDigest: oldDigest }).toEqual(before.context);
    expect(step.history.at(-1)).toEqual({
      kind: 'workload-carry-over',
      fromDigest: oldDigest,
      toDigest: typicalDigest,
      reason: 'a type-only edit',
    });
  });
  expect(labDigestProblems(repositoryRoot, same(rekeyed), LAB_STEPS)).toEqual([]);
});

test('an edit to a workload file moves the reviewed digest, and the re-keyed history replays', () => {
  const tree = mkdtempSync(join(tmpdir(), 'reference-digests-'));
  try {
    for (const file of [
      'tests/audit/support/performance-profile.ts',
      'tests/audit/support/seed-publication.ts',
      'lib/testing/fixture-publication.ts',
      'lib/testing/workload-archive',
    ])
      cpSync(resolve(repositoryRoot, file), join(tree, file), { recursive: true });
    expect(reviewedWorkloadDigest(tree, typical)).toBe(typicalDigest);
    const profile = join(tree, 'tests/audit/support/performance-profile.ts');
    writeFileSync(profile, 'export const typedAway = true;');
    const movedDigest = reviewedWorkloadDigest(tree, typical);
    expect(movedDigest).not.toBe(typicalDigest);

    const references = readLabReferences();
    const change = { fromDigest: typicalDigest, reason: 'a type-only edit' };
    const rekeyed = rekeyLabWorkload(tree, references, change);
    expect(rekeyed.steps.every((step) => step.context.workloadDigest === movedDigest)).toBe(true);
    expect(labReferenceProblems(rekeyed, LAB_STEPS)).toEqual([]);
    // The tree already on the digest moves nothing.
    expect(rekeyLabWorkload(repositoryRoot, references, change)).toEqual(references);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
});

test('a wall-clock re-key keeps every value and records the reason beside the reference', () => {
  const stale = wallClockOnOldWorkload();
  const rekeyed = rekeyWallClockWorkload(repositoryRoot, stale, MEASURED_SCENARIOS, {
    fromDigest: oldDigest,
    reason: 'a type-only edit',
  });
  rekeyed.baselines.forEach((baseline, index) => {
    const before = stale.baselines[index];
    if (!before) throw new Error(`No baseline at ${index}.`);
    expect(baseline.referenceMs).toBe(before.referenceMs);
    expect(baseline.samples).toEqual(before.samples);
    expect(baseline.review).toEqual(before.review);
    expect({ ...baseline.context, workloadDigest: before.context.workloadDigest }).toEqual(before.context);
    expect(baseline.workloadCarryOvers ?? []).toEqual([
      ...(before.workloadCarryOvers ?? []),
      ...(before.profile === 'typical'
        ? [{ fromDigest: oldDigest, toDigest: typicalDigest, reason: 'a type-only edit' }]
        : []),
    ]);
  });
  expect(wallClockDigestProblems(repositoryRoot, same(rekeyed), MEASURED_SCENARIOS)).toEqual([]);
});
