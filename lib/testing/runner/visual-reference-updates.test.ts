// Rule test: only a focused update run rewrites a visual reference, and an update run is no attempt.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { directGroupRetryProblem } from '../evidence/group-qualification';
import { focusedIterationAttemptsSinceLastPass } from './run-policy';
import {
  isVisualReferenceUpdateRun,
  VISUAL_REFERENCE_UPDATE_ENV,
  visualReferenceUpdateCommand,
  visualReferenceUpdateMode,
} from './visual-reference-updates';

test('only an explicit focused iteration rewrites visual references', () => {
  expect(
    visualReferenceUpdateMode({ WERKFLOW_TEST_LANE: 'iteration', [VISUAL_REFERENCE_UPDATE_ENV]: '1' }),
  ).toBe('changed');
  // A verification group, a diagnostic replay, or a stray variable compares and fails on a missing reference.
  for (const environment of [
    { WERKFLOW_TEST_LANE: 'group', [VISUAL_REFERENCE_UPDATE_ENV]: '1' },
    { WERKFLOW_TEST_LANE: 'diagnostic', [VISUAL_REFERENCE_UPDATE_ENV]: '1' },
    { WERKFLOW_TEST_LANE: 'iteration', [VISUAL_REFERENCE_UPDATE_ENV]: 'true' },
    { WERKFLOW_TEST_LANE: 'iteration' },
    {},
  ])
    expect([environment, visualReferenceUpdateMode(environment)]).toEqual([environment, 'none']);
});

test('the audit suite takes its snapshot mode from the update policy', () => {
  const config = readFileSync(join(import.meta.dir, '..', '..', '..', 'playwright.audit.config.ts'), 'utf8');
  expect(config).toContain('updateSnapshots: visualReferenceUpdateMode(process.env)');
});

const visualTitles = ['@AUDIT-VISUAL rendered references of every page family › dashboard'];
function iterationRun(runKey: string, command: string, status: string) {
  return {
    runKey,
    lane: 'iteration' as const,
    suite: 'audit' as const,
    target: 'local' as const,
    command,
    status,
    selectedTestIds: visualTitles,
    classification: 'harness' as const,
    classifiedAt: '2026-10-03T15:00:00.000Z',
  };
}

test('a reference update run is no attempt of the repeat rule, so repeated updates never block the update command', () => {
  const update = visualReferenceUpdateCommand('bun x playwright test --grep @AUDIT-VISUAL');
  expect(isVisualReferenceUpdateRun({ lane: 'iteration', command: update })).toBe(true);
  // A verification group never writes a reference, whatever its command says, so it always counts.
  expect(isVisualReferenceUpdateRun({ lane: 'group', command: update })).toBe(false);
  expect(isVisualReferenceUpdateRun({ lane: 'iteration', command: 'bun x playwright test' })).toBe(false);
  const request = { suite: 'audit' as const, target: 'local' as const, selectedTestIds: visualTitles };
  // Before 2026-10-03 the two failed update runs below were two same-class failures and blocked the update for good.
  const updates = [iterationRun('update-1', update, 'failed'), iterationRun('update-2', update, 'failed')];
  expect(focusedIterationAttemptsSinceLastPass(updates, request)).toEqual([]);
  // A plain focused failure still counts, and a passing update does not reset it.
  const plain = iterationRun('plain-1', 'bun x playwright test --grep @AUDIT-VISUAL', 'failed');
  expect(
    focusedIterationAttemptsSinceLastPass([plain, iterationRun('update-3', update, 'passed')], request).map(
      (attempt) => attempt.runKey,
    ),
  ).toEqual(['plain-1']);
});

test('an update cannot turn a failed verification green: the verification must pass on its own as a separate attempt', () => {
  const failedVerification = {
    runKey: 'verify-1',
    groupId: 'audit:visual',
    candidateFingerprint: 'references-before',
    target: 'local' as const,
    status: 'failed' as const,
    startedAt: '2026-10-03T15:00:00.000Z',
    retainedAt: '2026-10-03T15:05:00.000Z',
    cleanedAt: '2026-10-03T15:06:00.000Z',
  };
  const retry = (candidateFingerprint: string) =>
    directGroupRetryProblem({
      groupId: 'audit:visual',
      target: 'local',
      candidateFingerprint,
      runs: [failedVerification],
      recoveredRunKeys: [],
    });
  // An update that rewrote nothing leaves the inputs unchanged: the repeat stays refused.
  expect(retry('references-before')).toContain('an unchanged repeat is not a repair');
  // Accepted references are new inputs: the next verification is a first attempt that must pass by itself.
  expect(retry('references-after')).toBeUndefined();
});
