import { beforeEach, describe, expect, setSystemTime, spyOn, test } from 'bun:test';
import { z } from '@/lib/zod';

import {
  CLOCKED_OUT,
  WORKER,
  installTabLocks,
  resetDevice,
  storage,
} from '@/lib/testing/fixtures/time-outbox';
import { takeInKeptClockActions, untilCallAnswers, type KeptClockAction } from './kept-clock-actions';
import { beginSessionEnd, endSessionEnd, mayKeepUnder, renewSessionEnd } from './today-wipe';
import { callWhileKept, clockCallLock, keptActionsWait } from './unsent-mark';

// The kept store of werk-flow/werkflow-planning#319 (decision record 0010, the time outbox's
// invariants): an online call's action stays on the device until the server answered, a take-in
// that waits behind an open call still sees what it cannot read, and a discard waits for that call.

installTabLocks();
beforeEach(resetDevice);

/** A clock start as the provider writes it before its online call, tapped at `capturedAt`. */
function onlineStart(
  operationId: string,
  capturedAt = '2026-11-11T07:00:00.000Z',
): Omit<KeptClockAction, 'wipeGeneration'> {
  return {
    ...WORKER,
    operationId,
    action: 'start',
    expectedSessionId: null,
    expectedVersion: null,
    selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
    base: CLOCKED_OUT,
    readAt: '2026-11-11T06:59:00.000Z',
    triedOnline: true,
    capturedAt,
  };
}

/** The kept entries on the device, parsed. */
function keptEntries(): Record<string, unknown>[] {
  return [...storage.entries()]
    .filter(([key]) => key.startsWith('werkflow:unsent:clock:'))
    .map(([, value]) => z.record(z.string(), z.unknown()).parse(JSON.parse(value)));
}

/** Holds the call lock of `operationId` as its page does, until the answer comes; resolves once it holds it. */
async function pageHoldsCall(operationId: string): Promise<() => void> {
  let answer = (): void => undefined;
  let holding = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    holding = resolve;
  });
  void navigator.locks.request(clockCallLock(operationId), () => {
    holding();
    return new Promise<void>((resolve) => {
      answer = resolve;
    });
  });
  await held;
  return () => answer();
}

describe('an online call’s action on the device', () => {
  test('a call that fails while another tab’s session end checks keeps its action, under the same id, as a kept action', async () => {
    let fail: (reason: Error) => void = () => undefined;
    const calling = callWhileKept(
      onlineStart('50000000-0000-4000-8000-0000000000e1'),
      '',
      () =>
        new Promise((_resolve, reject: (reason: Error) => void) => {
          fail = reject;
        }),
    );
    const flow = beginSessionEnd();
    fail(new TypeError('Failed to fetch'));

    expect(await calling).toEqual(expect.objectContaining({ success: true, kept: true }));
    endSessionEnd(flow);
    expect(keptEntries()).toEqual([
      expect.objectContaining({ operationId: '50000000-0000-4000-8000-0000000000e1', inFlight: false }),
    ]);
  });

  test('a call the server answered leaves nothing kept', async () => {
    await callWhileKept(onlineStart('50000000-0000-4000-8000-0000000000e2'), '', async () => 'answered');
    expect(keptEntries()).toEqual([]);
  });
});

describe('an action this version cannot read', () => {
  test('stops the take-in: nothing kept behind it moves to the outbox before it', async () => {
    storage.set(
      'werkflow:unsent:clock:001762844400000:1:from-a-newer-version',
      '{"operationId":"x","kind":"new"}',
    );
    storage.set(
      'werkflow:unsent:clock:001762844500000:1:50000000-0000-4000-8000-0000000000e5',
      JSON.stringify({
        ...onlineStart('50000000-0000-4000-8000-0000000000e5'),
        triedOnline: false,
        wipeGeneration: '',
      }),
    );

    const taken = await takeInKeptClockActions(() => true);

    expect(taken.moved).toBe(0);
    expect(taken.unreadable).toBe(1);
    // Both stay kept: the unreadable one, and the readable one behind it.
    expect(keptEntries().map((entry) => entry.operationId)).toEqual([
      'x',
      '50000000-0000-4000-8000-0000000000e5',
    ]);
  });

  test('makes a page keep a new tap behind it instead of sending it online', () => {
    storage.set(
      'werkflow:unsent:clock:001762844400000:1:from-a-newer-version',
      '{"operationId":"x","kind":"new"}',
    );
    expect(keptActionsWait()).toBe(true);
    storage.clear();
    expect(keptActionsWait()).toBe(false);
  });
});

describe('a take-in behind an open call', () => {
  test('counts an action it cannot read behind the call, so a session end fails closed', async () => {
    const answer = await pageHoldsCall('50000000-0000-4000-8000-0000000000e3');
    storage.set(
      'werkflow:unsent:clock:001762844400000:1:50000000-0000-4000-8000-0000000000e3',
      JSON.stringify({
        ...onlineStart('50000000-0000-4000-8000-0000000000e3', '2026-11-01T07:00:00.000Z'),
        inFlight: true,
        wipeGeneration: '',
      }),
    );
    storage.set(
      'werkflow:unsent:clock:001762844500000:1:from-a-newer-version',
      '{"operationId":"x","kind":"new"}',
    );

    const taken = await takeInKeptClockActions(() => true);

    expect(taken.unreadable).toBe(1);
    expect(taken.deferred?.actions.map((action) => action.operationId)).toEqual([
      '50000000-0000-4000-8000-0000000000e3',
    ]);
    answer();
  });

  test('a discard waits through a fresh call’s first seconds and then for its lock', async () => {
    const answer = await pageHoldsCall('50000000-0000-4000-8000-0000000000e4');
    setSystemTime(new Date('2026-11-11T07:00:02.000Z'));
    const timers = spyOn(globalThis, 'setTimeout');
    try {
      let answered = false;
      const waiting = untilCallAnswers({
        actions: [
          { ...onlineStart('50000000-0000-4000-8000-0000000000e4'), inFlight: true, wipeGeneration: '' },
        ],
        recheckAt: Date.parse('2026-11-11T07:00:10.000Z'),
        lock: null,
      }).then(() => {
        answered = true;
      });
      const index = timers.mock.calls.findIndex(([, delay]) => typeof delay === 'number' && delay > 1_000);
      const [grant] = timers.mock.calls[index] ?? [];
      if (typeof grant !== 'function') throw new Error('no wait through the first seconds');
      const scheduled = timers.mock.results[index];
      if (scheduled?.type === 'return') clearTimeout(scheduled.value);
      grant();
      await Promise.resolve();
      expect(answered).toBe(false);

      answer();
      await waiting;
      expect(answered).toBe(true);
    } finally {
      timers.mockRestore();
      setSystemTime();
    }
  });
});

describe('a session end’s barrier', () => {
  test('one that lapsed is reported as lost, so the flow checks again, and stands again after the renewal', () => {
    setSystemTime(new Date('2026-11-11T07:00:00.000Z'));
    try {
      const flow = beginSessionEnd();
      expect(renewSessionEnd(flow)).toBe(true);
      // The tab froze for eleven minutes: the barrier lapsed, and another tab could keep meanwhile.
      setSystemTime(new Date('2026-11-11T07:11:00.000Z'));
      expect(mayKeepUnder('')).toBe(true);
      expect(renewSessionEnd(flow)).toBe(false);
      expect(mayKeepUnder('')).toBe(false);
      endSessionEnd(flow);
    } finally {
      setSystemTime();
    }
  });
});
