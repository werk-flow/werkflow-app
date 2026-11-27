import { expect, test } from 'bun:test';
import { retryWindowAt, retryWindowEnd } from './retry-window';

// A delivery row follows the clock until nothing can change by it. Tier 2.

const at = (iso: string) => Date.parse(iso);

test('a sending attempt begun after the retry closed still turns unanswered on a mounted row', () => {
  // Requested at 00:00, its last attempt began at 22:55: the retry closes at
  // 23:00, the attempt reads as unanswered from 23:05.
  const entry = {
    state: 'sending' as const,
    retryFrom: '2037-11-21T23:05:00.000Z',
    retryUntil: '2037-11-21T23:00:00.000Z',
  };
  expect(retryWindowEnd(entry)).toBe(at(entry.retryFrom));
  expect(retryWindowAt(entry, at('2037-11-21T23:01:00.000Z'))).toEqual({
    retryable: false,
    unanswered: false,
  });
  expect(retryWindowAt(entry, at('2037-11-21T23:05:00.000Z'))).toEqual({
    retryable: false,
    unanswered: true,
  });
});

test('a failed or early sending row stops at the end of its retry, a sent row never ticks', () => {
  const failed = {
    state: 'failed' as const,
    retryFrom: '2037-11-21T10:00:00.000Z',
    retryUntil: '2037-11-22T09:00:00.000Z',
  };
  expect(retryWindowEnd(failed)).toBe(at(failed.retryUntil));
  expect(retryWindowAt(failed, at('2037-11-21T10:00:00.000Z'))).toEqual({
    retryable: true,
    unanswered: false,
  });
  expect(retryWindowAt(failed, at(failed.retryUntil))).toEqual({ retryable: false, unanswered: false });
  const sending = {
    state: 'sending' as const,
    retryFrom: '2037-11-21T10:10:00.000Z',
    retryUntil: '2037-11-22T09:00:00.000Z',
  };
  expect(retryWindowEnd(sending)).toBe(at(sending.retryUntil));
  expect(retryWindowEnd({ state: 'sent', retryFrom: null, retryUntil: null })).toBeNull();
});
