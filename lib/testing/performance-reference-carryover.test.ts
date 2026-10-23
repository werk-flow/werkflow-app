// Rule test: a carried-over reference keeps the measured code its review saw.
// The change that adds an entry proves it; no entry is open, so no file-digest proof remains here.
import { expect, test } from 'bun:test';

import baselineFile from './performance-baselines.json';
import { MEASUREMENT_VERSION } from './measured-scenarios';
import {
  carryOverReferences,
  readReferenceCarryover,
  type PerformanceBaselines,
} from './performance-baselines';
import { performanceContextFixture } from './fixtures/performance';

test('every carry-over entry re-keys a reviewed reference; a stale entry is deleted', () => {
  const recorded = baselineFile.baselines.map(
    (baseline) => `${baseline.scenarioId}@${baseline.context.measurementDigest}`,
  );
  const stale = readReferenceCarryover()
    .entries.map((entry) => `${entry.scenarioId}@${entry.fileDigest}`)
    .filter((key) => !recorded.includes(key));
  expect(stale).toEqual([]);
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
