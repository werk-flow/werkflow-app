// Rule test: every required scenario has a reviewed reference at its digest.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { MEASURED_SCENARIOS } from './measured-scenarios';
import baselineFile from './performance-baselines.json';
import { performanceBaselinesSchema, readPerformanceBaselines } from './performance-baselines';
import { wallClockDigestProblems } from './reference-digests';

const repositoryRoot = resolve(import.meta.dir, '../..');

// A `required` scenario whose reference does not match the current measurement
// digest fails its group with "no reviewed baseline" although every sample may
// be within target (2026-09-17: six digest inputs were edited after the last
// transfer and all eleven references were orphaned without anyone noticing until
// the next release plan). Either recalibrate and activate a reference at the
// current digest, or mark the scenario `calibrating` until that happens. The
// same holds for a moved workload digest (2026-11-01: #151).
test('every required scenario has a reviewed reference at its current measurement and workload digest', () => {
  const stored = performanceBaselinesSchema.parse(baselineFile);
  const problems = wallClockDigestProblems(
    repositoryRoot,
    { stored, carried: readPerformanceBaselines() },
    MEASURED_SCENARIOS,
  );
  expect(problems, problems.join('\n')).toEqual([]);
});
