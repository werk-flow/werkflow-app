import { describe, expect, test } from 'bun:test';

import { CLOCKED_OUT, SESSION_ID, WORKING } from '@/lib/testing/fixtures/time-outbox';
import { correctionOffered, type ClockDeviceView } from './time-outbox';

// Whether a stopped chain offers „Korrektur beantragen“ (decision record 0010, "a late chain of a
// session that still runs"): an approved addition plus the later end of a session the server still
// holds open would count the same time twice.

/** A stopped chain whose first event is `action`, expecting `sessionId` on the server. */
function stoppedChain(action: 'start' | 'switch' | 'end', sessionId: string | null): ClockDeviceView {
  return {
    status: 'stopped',
    state: null,
    events: [
      {
        operationId: '50000000-0000-4000-8000-0000000000c1',
        capturedAt: '2026-11-09T09:00:00.000Z',
        action,
        selection: action === 'end' ? null : { kind: 'break', allocationKind: 'none' },
        expected: { sessionId, version: sessionId ? 3 : null },
        status: 'correction',
        code: 'correction_required',
      },
    ],
  };
}

describe('a correction for a stopped chain', () => {
  test('is not offered while the session the chain expects still runs on the server', () => {
    // Online clock-in, then a switch and an end kept offline and sent more than 24 hours late.
    expect(correctionOffered(stoppedChain('switch', SESSION_ID), WORKING)).toBe(false);
  });

  test('is offered for a chain that begins with its own start', () => {
    expect(correctionOffered(stoppedChain('start', null), CLOCKED_OUT)).toBe(true);
  });

  test('is offered once the session the chain expects no longer runs', () => {
    expect(correctionOffered(stoppedChain('switch', SESSION_ID), CLOCKED_OUT)).toBe(true);
  });

  test('is not offered while the server’s clock is unknown: the device cannot tell whether the session runs', () => {
    expect(correctionOffered(stoppedChain('start', null), null)).toBe(false);
  });
});
