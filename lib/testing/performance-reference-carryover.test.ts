// Rule test: a carried-over reference keeps the measured code its review saw.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';

import baselineFile from './performance-baselines.json';
import { contentDigest } from './evidence/source-content';
import { MEASUREMENT_VERSION, MEASURED_SCENARIOS, type MeasuredScenario } from './measured-scenarios';
import {
  carryOverReferences,
  readReferenceCarryover,
  type PerformanceBaselines,
} from './performance-baselines';
import { measurementDigest, performanceProtocol } from './performance-context';
import { performanceContextFixture } from './fixtures/performance';

const repositoryRoot = resolve(import.meta.dir, '../..');

/** The retired whole-file measurement digest, kept here only to repeat the carry-over proof. */
function fileMeasurementDigest(scenario: MeasuredScenario): string {
  const digest = createHash('sha256').update(
    JSON.stringify({
      version: MEASUREMENT_VERSION,
      id: scenario.id,
      scenarioVersion: scenario.version,
      boundary: scenario.boundary,
      samples: scenario.samples,
      protocol: performanceProtocol(scenario),
    }),
  );
  for (const file of [
    scenario.file,
    'tests/golden/support/scenario-measurement.ts',
    'tests/golden/support/browser-observation.ts',
    'tests/golden/support/sessions.ts',
    'lib/testing/live-observation.ts',
    'tests/audit/support/performance-steps.ts',
  ])
    digest
      .update(file)
      .update('\0')
      .update(contentDigest(file, readFileSync(resolve(repositoryRoot, file))))
      .update('\0');
  return digest.digest('hex');
}

test('every carry-over entry re-keys a reviewed reference; a stale entry is deleted', () => {
  const recorded = baselineFile.baselines.map(
    (baseline) => `${baseline.scenarioId}@${baseline.context.measurementDigest}`,
  );
  const stale = readReferenceCarryover()
    .entries.map((entry) => `${entry.scenarioId}@${entry.fileDigest}`)
    .filter((key) => !recorded.includes(key));
  expect(stale).toEqual([]);
});

// The proof: on a tree where the whole-file digest still equals the one the
// reference was recorded under, the measured code is the code the review saw,
// and the entry must name the measured-test digest of that same tree. Entries
// whose spec changed since carry-over were proven in the change that added them.
test('a carry-over entry names the measured-test digest of the tree its file digest identifies', () => {
  const wrong = readReferenceCarryover().entries.flatMap((entry) => {
    const scenario = MEASURED_SCENARIOS.find((candidate) => candidate.id === entry.scenarioId);
    if (!scenario) return [`${entry.scenarioId}: unknown scenario`];
    if (fileMeasurementDigest(scenario) !== entry.fileDigest) return [];
    return measurementDigest(repositoryRoot, scenario) === entry.measuredTestDigest
      ? []
      : [`${entry.scenarioId}: measured-test digest differs on the carried-over tree`];
  });
  expect(wrong).toEqual([]);
});

test('carry-over re-keys only the matching scenario and digest and keeps every reviewed value', () => {
  const baseline = {
    scenarioId: 'customers.list.open',
    scenarioVersion: 1,
    profile: 'typical' as const,
    backend: 'local' as const,
    context: { ...performanceContextFixture, measurementDigest: 'a'.repeat(64) },
    referenceMs: 800,
    samples: [790, 800, 810],
    source: {
      runKey: 'run-1',
      runKeys: ['run-1'],
      buildId: 'build-1',
      recordedAt: '2026-10-02T20:44:50.360Z',
    },
    review: { reason: 'reviewed', reviewedAt: '2026-10-02T21:08:36.820Z' },
  };
  const baselines: PerformanceBaselines = {
    version: 1,
    measurementVersion: MEASUREMENT_VERSION,
    tolerance: { relative: 0.25, absoluteMs: 250 },
    baselines: [baseline, { ...baseline, scenarioId: 'jobs.list.open' }],
  };
  const carried = carryOverReferences(baselines, {
    reason: 'narrowed',
    entries: [
      { scenarioId: 'customers.list.open', fileDigest: 'a'.repeat(64), measuredTestDigest: 'b'.repeat(64) },
    ],
  });
  expect(carried.baselines[0]).toEqual({
    ...baseline,
    context: { ...baseline.context, measurementDigest: 'b'.repeat(64) },
  });
  expect(carried.baselines[1]).toEqual({ ...baseline, scenarioId: 'jobs.list.open' });
});
