// Rule test: the runner judges every lab record of a run against the reviewed references.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'bun:test';

import { initialLabReference, type LabReferences } from './lab-counts';
import { LAB_ARCHIVE, LAB_MEASUREMENT_VERSION, type LabObservation } from './lab-record';
import { checkLabEvidence } from './lab-evidence';
import { getLabStep, LAB_METRICS, type LabMetric } from './lab-steps';

const STEP = getLabStep('lab.field.checklist-tick');
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function observation(overrides: Partial<Record<LabMetric, number>> = {}): LabObservation {
  const counts = Object.fromEntries(LAB_METRICS.map((metric) => [metric, 2])) as Record<LabMetric, number>;
  return {
    stepId: STEP.id,
    stepVersion: STEP.version,
    labMeasurementVersion: LAB_MEASUREMENT_VERSION,
    buildId: 'build',
    context: {
      measurementDigest: 'a'.repeat(64),
      workloadDigest: 'b'.repeat(64),
      browser: 'chromium',
      browserVersion: '140',
      viewport: STEP.viewport,
      cpuThrottle: STEP.cpuThrottle,
      role: STEP.role,
      backend: 'local',
    },
    counts: { ...counts, routeRenders: 1, ...overrides },
    payloads: [
      {
        shape: 'action:/auftraege/[jobNumber]',
        requests: 1,
        encodedBytes: 900,
        decodedBytes: 9_000,
        rows: null,
      },
    ],
    wallClockMs: 300,
    recordedAt: '2026-10-09T08:00:00.000Z',
  };
}

function references(): LabReferences {
  const runs = ['r1', 'r2', 'r3', 'r4', 'r5'];
  return {
    version: 1,
    steps: [
      initialLabReference({
        step: STEP,
        observations: runs.map(() => observation()),
        runKeys: runs,
        buildId: 'build',
        gated: ['requests', 'routeRenders'],
      }).reference,
    ],
    gatedMetrics: [
      { metric: 'requests', stability: 's', relevance: 'r', runKeys: ['r1'] },
      { metric: 'routeRenders', stability: 's', relevance: 'r', runKeys: ['r1'] },
    ],
    rejectedMetrics: [],
  };
}

function run(lines: readonly string[]): string {
  const directory = mkdtempSync(join(tmpdir(), 'lab-evidence-'));
  directories.push(directory);
  writeFileSync(join(directory, LAB_ARCHIVE), lines.map((line) => `${line}\n`).join(''));
  return directory;
}

function check(lines: readonly string[], mode: { enforceCeilings: boolean; release: boolean }) {
  return checkLabEvidence({
    directory: run(lines),
    runKey: 'run-key',
    requiredSteps: [STEP.id],
    references: references(),
    ...mode,
  });
}

const RELEASE = { enforceCeilings: true, release: true };
const EXPLICIT = { enforceCeilings: true, release: false };
const RECORDED = { enforceCeilings: false, release: false };

describe('lab evidence', () => {
  test('a record within its reference passes and prints its table', () => {
    const result = check([JSON.stringify(observation())], RELEASE);
    expect(result.problems).toEqual([]);
    expect(result.table[0]).toContain(STEP.id);
  });

  test('a missing, duplicated, malformed or foreign record fails in every mode', () => {
    expect(check([], RECORDED).problems.join()).toContain('recorded 0 lab records');
    const twice = JSON.stringify(observation());
    expect(check([twice, twice], RECORDED).problems.join()).toContain('recorded 2 lab records');
    expect(check(['{"stepId":'], RECORDED).problems.join()).toContain('malformed');
    const foreign = JSON.stringify({ ...observation(), stepId: 'lab.field.clock-in' });
    expect(check([JSON.stringify(observation()), foreign], RECORDED).problems.join()).toContain(
      'not a step of this group',
    );
  });

  test('a regression fails when ceilings are enforced and is a note otherwise', () => {
    const regressed = [JSON.stringify(observation({ requests: 5 }))];
    expect(check(regressed, EXPLICIT).problems.join()).toContain('regressed');
    expect(check(regressed, RECORDED).problems).toEqual([]);
    expect(check(regressed, RECORDED).overTarget.join()).toContain('regressed');
  });

  test('an improvement names the lowering command and fails in release mode only', () => {
    const improved = [JSON.stringify(observation({ requests: 1 }))];
    expect(check(improved, EXPLICIT).problems).toEqual([]);
    expect(check(improved, EXPLICIT).overTarget.join()).toContain(
      'bun scripts/lab-counts.ts ratchet --run run-key',
    );
    expect(check(improved, RELEASE).problems.join()).toContain('ratchet --run run-key');
  });

  test('a payload that shrank below its floor asks to confirm nothing is missing', () => {
    const shrunk = observation();
    const payload = {
      ...shrunk.payloads[0],
      shape: 'action:/auftraege/[jobNumber]',
      requests: 1,
      encodedBytes: 900,
      decodedBytes: 1_000,
      rows: null,
    };
    const result = check([JSON.stringify({ ...shrunk, payloads: [payload] })], EXPLICIT);
    expect(result.problems.join()).toContain('confirm nothing is missing');
  });

  test('a record without a reference fails a required step in release mode only', () => {
    const other = {
      ...observation(),
      context: { ...observation().context, measurementDigest: 'c'.repeat(64) },
    };
    const judge = (release: boolean) =>
      checkLabEvidence({
        directory: run([JSON.stringify(other)]),
        runKey: 'run-key',
        requiredSteps: [STEP.id],
        references: references(),
        steps: [{ ...STEP, comparison: 'required' }],
        enforceCeilings: true,
        release,
      });
    expect(judge(false).problems).toEqual([]);
    expect(judge(false).overTarget.join()).toContain('no reviewed lab reference');
    expect(judge(true).problems.join()).toContain('no reviewed lab reference');
  });
});

test('a required step that the registry does not know fails every mode', () => {
  const result = checkLabEvidence({
    directory: run([JSON.stringify(observation())]),
    runKey: 'run-key',
    requiredSteps: [STEP.id],
    references: references(),
    steps: [],
    enforceCeilings: false,
    release: false,
  });
  expect(result.problems.join()).toContain('not a registered lab step');
});
