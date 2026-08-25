import { describe, expect, test } from 'bun:test';

import {
  evaluateFullCertificationRerun,
  shouldRefreshStoredSession,
  validateRunRequest,
} from './run-policy';

describe('Playwright run policy', () => {
  test('keeps iteration and diagnostic runs focused', () => {
    expect(
      validateRunRequest({ lane: 'iteration', suite: 'golden', grep: null, reuseRunKey: null })
    ).toHaveLength(1);
    expect(
      validateRunRequest({ lane: 'iteration', suite: 'golden', grep: '  ', reuseRunKey: null })
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: 'diagnostic',
        suite: 'golden',
        grep: '@P1-16-stage-boundaries',
        reuseRunKey: 'run-1',
      })
    ).toEqual([]);
    expect(
      validateRunRequest({ lane: 'diagnostic', suite: 'golden', grep: null, reuseRunKey: null })
    ).toHaveLength(2);
    expect(
      validateRunRequest({
        lane: 'certification',
        suite: 'golden',
        grep: '@P1-16',
        reuseRunKey: null,
      })
    ).toHaveLength(1);
    expect(
      validateRunRequest({
        lane: 'certification',
        suite: 'golden',
        grep: null,
        reuseRunKey: 'run-1',
      })
    ).toHaveLength(1);
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
        },
      ],
      focusedVerifications: [
        {
          status: 'passed',
          startedAt: '2026-08-25T11:00:00Z',
          sourceFingerprint: 'old-source',
        },
      ],
      currentSourceFingerprint: 'source-a',
      overrideReason: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('focused verification');
  });

  test('allows one classified retry after focused proof and stops a repeated class', () => {
    const attempts = [
      {
        runKey: 'failed-1',
        status: 'failed' as const,
        startedAt: '2026-08-25T10:00:00Z',
        classification: 'harness' as const,
        classifiedAt: '2026-08-25T10:30:00Z',
      },
    ];
    const focusedVerifications = [
      {
        status: 'passed' as const,
        startedAt: '2026-08-25T11:00:00Z',
        sourceFingerprint: 'source-a',
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
  }>,
  focusedVerifications: Array<{
    status: 'passed';
    startedAt: string;
    sourceFingerprint: string;
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
      },
    ],
    currentSourceFingerprint: 'source-a',
  };
}
