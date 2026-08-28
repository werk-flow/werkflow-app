import { describe, expect, test } from 'bun:test';

import {
  defaultTargetForSuite,
  evaluateFullCertificationRerun,
  focusedGrepCoversToken,
  focusedProofToken,
  shouldRefreshStoredSession,
  validateRunRequest,
} from './run-policy';

describe('Playwright run policy', () => {
  test('keeps iteration and diagnostic runs focused', () => {
    expect(
      validateRunRequest({ lane: 'iteration', suite: 'golden', target: 'local', grep: null, reuseRunKey: null })
    ).toHaveLength(1);
    expect(
      validateRunRequest({ lane: 'iteration', suite: 'golden', target: 'local', grep: '  ', reuseRunKey: null })
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: 'diagnostic',
        suite: 'golden',
        target: 'local',
        grep: '@P1-16-stage-boundaries',
        reuseRunKey: 'run-1',
      })
    ).toEqual([]);
    expect(
      validateRunRequest({ lane: 'diagnostic', suite: 'golden', target: 'local', grep: null, reuseRunKey: null })
    ).toHaveLength(2);
    expect(
      validateRunRequest({
        lane: 'certification',
        suite: 'golden',
        target: 'local',
        grep: '@P1-16',
        reuseRunKey: null,
      })
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: 'certification',
        suite: 'golden',
        target: 'local',
        grep: null,
        reuseRunKey: 'run-1',
      })
    ).toHaveLength(1);
  });

  test('pins the canary suite to the cloud target', () => {
    expect(
      validateRunRequest({
        lane: 'certification',
        suite: 'canary',
        target: 'local',
        grep: null,
        reuseRunKey: null,
      })
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: 'certification',
        suite: 'canary',
        target: 'cloud',
        grep: null,
        reuseRunKey: null,
      })
    ).toEqual([]);
    expect(defaultTargetForSuite('canary')).toBe('cloud');
    expect(defaultTargetForSuite('golden')).toBe('local');
    expect(defaultTargetForSuite('audit')).toBe('local');
  });

  test('refreshes old, future-dated, and wrong-organization sessions', () => {
    const now = Date.parse('2026-08-25T12:00:00Z');
    expect(shouldRefreshStoredSession(now - 14 * 60_000, now, true)).toBe(false);
    expect(shouldRefreshStoredSession(now - 15 * 60_000, now, true)).toBe(true);
    expect(shouldRefreshStoredSession(now + 1, now, true)).toBe(true);
    expect(shouldRefreshStoredSession(Number.NaN, now, true)).toBe(true);
    expect(shouldRefreshStoredSession(now, now, false)).toBe(true);
  });

  test('blocks an unclassified full-run retry', () => {
    const result = evaluateFullCertificationRerun({
      attemptsSinceLastPass: [
        {
          runKey: 'failed-1',
          status: 'failed',
          startedAt: '2026-08-25T10:00:00Z',
          classification: null,
          classifiedAt: null,
          failedSpecFile: null,
        },
      ],
      focusedVerifications: [],
      currentSourceFingerprint: 'source-a',
      overrideReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Classify failed full run failed-1');
  });

  test('requires focused proof after classification', () => {
    const result = evaluateFullCertificationRerun({
      attemptsSinceLastPass: [
        {
          runKey: 'failed-1',
          status: 'failed',
          startedAt: '2026-08-25T10:00:00Z',
          classification: 'harness',
          classifiedAt: '2026-08-25T10:30:00Z',
          failedSpecFile: null,
        },
      ],
      focusedVerifications: [
        {
          status: 'passed',
          startedAt: '2026-08-25T11:00:00Z',
          sourceFingerprint: 'old-source',
          grep: '@P1-16',
        },
      ],
      currentSourceFingerprint: 'source-a',
      overrideReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('focused verification');
  });

  test('derives the proof token from the failed spec file', () => {
    expect(focusedProofToken('tests/golden/p1-16.spec.ts')).toBe('p1-16');
    expect(focusedProofToken('tests\\golden\\gg-00.spec.ts')).toBe('gg-00');
    expect(focusedProofToken('scripts/run-playwright.ts')).toBe(null);
    expect(focusedProofToken(null)).toBe(null);
  });

  test('matches proof tokens at boundaries, not as bare substrings', () => {
    expect(focusedGrepCoversToken('@P1-16', 'p1-16')).toBe(true);
    expect(focusedGrepCoversToken('@P1-16-stage-boundaries', 'p1-16')).toBe(true);
    expect(focusedGrepCoversToken('@P1-16', 'p1-1')).toBe(false);
    expect(focusedGrepCoversToken('@P1-01', 'p1-16')).toBe(false);
  });

  test('requires the focused proof to cover the failed spec', () => {
    const base = {
      attemptsSinceLastPass: [
        {
          runKey: 'failed-1',
          status: 'failed' as const,
          startedAt: '2026-08-25T10:00:00Z',
          classification: 'harness' as const,
          classifiedAt: '2026-08-25T10:30:00Z',
          failedSpecFile: 'tests/golden/p1-16.spec.ts',
        },
      ],
      currentSourceFingerprint: 'source-a',
      overrideReason: null,
    };
    const unrelatedProof = evaluateFullCertificationRerun({
      ...base,
      focusedVerifications: [
        {
          status: 'passed',
          startedAt: '2026-08-25T11:00:00Z',
          sourceFingerprint: 'source-a',
          grep: '@GG-00',
        },
      ],
    });
    expect(unrelatedProof.allowed).toBe(false);
    expect(unrelatedProof.reason).toContain('covering p1-16');

    const scopedProof = evaluateFullCertificationRerun({
      ...base,
      focusedVerifications: [
        {
          status: 'passed',
          startedAt: '2026-08-25T11:00:00Z',
          sourceFingerprint: 'source-a',
          grep: '@P1-16-stage-boundaries',
        },
      ],
    });
    expect(scopedProof.allowed).toBe(true);
  });

  test('allows one classified retry after focused proof and stops a repeated class', () => {
    const attempts = [
      {
        runKey: 'failed-1',
        status: 'failed' as const,
        startedAt: '2026-08-25T10:00:00Z',
        classification: 'harness' as const,
        classifiedAt: '2026-08-25T10:30:00Z',
        failedSpecFile: null,
      },
    ];
    const focusedVerifications = [
      {
        status: 'passed' as const,
        startedAt: '2026-08-25T11:00:00Z',
        sourceFingerprint: 'source-a',
        grep: '@P1-16',
      },
    ];
    expect(
      evaluateFullCertificationRerun({
        attemptsSinceLastPass: attempts,
        focusedVerifications,
        currentSourceFingerprint: 'source-a',
        overrideReason: null,
      }).allowed
    ).toBe(true);

    const repeatedScenario = repeatedInput(attempts, focusedVerifications);
    const repeated = evaluateFullCertificationRerun({
      ...repeatedScenario,
      overrideReason: null,
    });
    expect(repeated.allowed).toBe(false);
    expect(repeated.reason).toContain('last two full runs');
    expect(
      evaluateFullCertificationRerun({ ...repeatedScenario, overrideReason: '  ' }).allowed
    ).toBe(false);
    expect(
      evaluateFullCertificationRerun({
        ...repeatedScenario,
        overrideReason: 'Two unrelated server incidents were verified from archived logs.',
      }).allowed
    ).toBe(true);
  });
});

function repeatedInput(
  attempts: Array<{
    runKey: string;
    status: 'failed';
    startedAt: string;
    classification: 'harness';
    classifiedAt: string;
    failedSpecFile: string | null;
  }>,
  focusedVerifications: Array<{
    status: 'passed';
    startedAt: string;
    sourceFingerprint: string;
    grep: string;
  }>
) {
  return {
    attemptsSinceLastPass: [
      ...attempts,
      {
        ...attempts[0],
        runKey: 'failed-2',
        startedAt: '2026-08-25T12:00:00Z',
        classifiedAt: '2026-08-25T12:30:00Z',
      },
    ],
    focusedVerifications: [
      ...focusedVerifications,
      {
        status: 'passed' as const,
        startedAt: '2026-08-25T13:00:00Z',
        sourceFingerprint: 'source-a',
        grep: '@P1-16',
      },
    ],
    currentSourceFingerprint: 'source-a',
  };
}
