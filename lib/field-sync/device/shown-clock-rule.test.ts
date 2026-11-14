import { describe, expect, test } from 'bun:test';

import { CLOCKED_OUT, SESSION_ID } from '@/lib/testing/fixtures/time-outbox';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { NOTHING_SHOWN, advanceShownClock, type ClockFacts, type ShownMemory } from './shown-clock-rule';
import type { ClockDeviceView } from './time-outbox';

// What the clock shows while the connection changes (decision record 0010, the amendment "what the
// clock shows while the connection changes"): the person's own actions at once, the server's state
// only once it answered after them, and never a state in between.

const WORKING: LiveClockState = {
  ...CLOCKED_OUT,
  status: 'working',
  isClockedIn: true,
  clockInTime: '2026-11-11T07:00:00.000Z',
  statusStartedAt: '2026-11-11T07:00:00.000Z',
  sessionId: SESSION_ID,
  sessionVersion: 1,
  currentActivity: { kind: 'work', allocationKind: 'unallocated', jobId: null },
};

const PENDING_START: ClockDeviceView = {
  status: 'pending',
  state: WORKING,
  events: [
    {
      operationId: '50000000-0000-4000-8000-0000000000a1',
      capturedAt: '2026-11-11T07:00:00.000Z',
      action: 'start',
      selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
      expected: { sessionId: null, version: null },
      status: 'pending',
      code: null,
    },
  ],
};

const STOPPED_START: ClockDeviceView = {
  status: 'stopped',
  state: null,
  events: PENDING_START.events.map((event) => ({ ...event, status: 'conflict', code: 'version_conflict' })),
};

/** Online, clocked out, read at 10; nothing on the device. */
const SETTLED: ClockFacts = {
  server: CLOCKED_OUT,
  serverFrom: 10,
  failedFrom: -1,
  device: null,
  deviceFrom: -1,
  keptEcho: null,
  checkingDevice: false,
  online: true,
  scope: 'worker:company',
};

/** What the person sees: the clock's state and its marker, or nothing. */
function seen(memory: ShownMemory): string {
  const { state, marker, device } = memory.shown;
  const clock = state ? (state.isClockedIn ? 'eingestempelt' : 'nicht eingestempelt') : 'nichts';
  const badge = device?.status === 'stopped' ? device.events[0]?.status : null;
  return [clock, marker, badge].filter(Boolean).join(' · ');
}

/** Every distinct screen, in order, as the facts follow one another. */
function screens(steps: ClockFacts[]): string[] {
  let memory = NOTHING_SHOWN;
  const shown: string[] = [];
  for (const facts of steps) {
    memory = advanceShownClock(memory, facts);
    const screen = seen(memory);
    if (shown.at(-1) !== screen) shown.push(screen);
  }
  return shown;
}

describe('the shown clock', () => {
  test('going offline keeps the confirmed clock and only adds the calm marker', () => {
    expect(screens([SETTLED, { ...SETTLED, online: false }, { ...SETTLED, online: true }])).toEqual([
      'nicht eingestempelt',
      'nicht eingestempelt · offline',
      'nicht eingestempelt',
    ]);
  });

  test('a kept tap shows at once, and a server read while it waits never replaces it', () => {
    const offline = { ...SETTLED, online: false };
    expect(
      screens([
        offline,
        { ...offline, keptEcho: WORKING },
        // A catch-up read answers the server's clock before the action was sent.
        { ...offline, keptEcho: WORKING, serverFrom: 20, failedFrom: 15 },
      ]),
    ).toEqual(['nicht eingestempelt · offline', 'eingestempelt · waiting']);
  });

  test('coming back online shows „sending“, then the server’s answer, never the clock from before the send', () => {
    const waiting = { ...SETTLED, online: false, keptEcho: WORKING };
    expect(
      screens([
        waiting,
        // `online`: the outbox takes the kept action in; a catch-up read starts at 25.
        { ...waiting, online: true, keptEcho: null, device: PENDING_START, deviceFrom: 30 },
        // That read answers the clock before the send.
        { ...waiting, online: true, keptEcho: null, device: PENDING_START, deviceFrom: 30, serverFrom: 25 },
        // The send was recorded; the outbox answers that nothing waits.
        { ...SETTLED, serverFrom: 25, deviceFrom: 40 },
        // The read after it answers the running clock.
        { ...SETTLED, server: WORKING, serverFrom: 41, deviceFrom: 40 },
      ]),
    ).toEqual(['eingestempelt · waiting', 'eingestempelt · sending', 'eingestempelt']);
  });

  test('a send that fails keeps the clock with its marker, and only the network decides its words', () => {
    const sending = { ...SETTLED, device: PENDING_START, deviceFrom: 30 };
    expect(
      screens([
        sending,
        // The pass failed: the outbox answers again, still waiting.
        { ...sending, device: { ...PENDING_START }, deviceFrom: 35 },
        { ...sending, online: false },
      ]),
    ).toEqual(['eingestempelt · sending', 'eingestempelt · waiting']);
  });

  test('a conflict shows the server’s clock and its badge together, nothing in between', () => {
    const sending = { ...SETTLED, device: PENDING_START, deviceFrom: 30 };
    expect(
      screens([
        sending,
        // The server answered with a conflict: the chain stops.
        { ...SETTLED, device: STOPPED_START, deviceFrom: 40 },
        { ...SETTLED, device: STOPPED_START, deviceFrom: 40, serverFrom: 41 },
      ]),
    ).toEqual(['eingestempelt · sending', 'nicht eingestempelt · conflict']);
  });

  test('a read that fails with network after the send shows the failure’s ground; one without network is no answer', () => {
    const settled = { ...SETTLED, device: STOPPED_START, deviceFrom: 40 };
    expect(
      screens([
        { ...SETTLED, device: PENDING_START, deviceFrom: 30 },
        // Without network a failed read is never reported (clock-state-provider.tsx).
        { ...settled, online: false },
        { ...settled, failedFrom: 42 },
      ]),
    ).toEqual(['eingestempelt · sending', 'eingestempelt · waiting', 'nicht eingestempelt · conflict']);
  });

  test('the network’s return alone ends no wait: only an answer after it does', () => {
    const settled = { ...SETTLED, deviceFrom: 40 };
    let memory = advanceShownClock(NOTHING_SHOWN, { ...SETTLED, device: PENDING_START, deviceFrom: 30 });
    memory = advanceShownClock(memory, { ...settled, online: false });
    memory = advanceShownClock(memory, settled);
    expect(seen(memory)).toBe('eingestempelt · sending');
    expect(memory.shown.settling).toBe(true);
  });

  test('a tap kept on top of waiting events shows at once, before the outbox takes it in', () => {
    const waiting = { ...SETTLED, online: false, device: PENDING_START, deviceFrom: 30 };
    expect(screens([waiting, { ...waiting, keptEcho: CLOCKED_OUT }])).toEqual([
      'eingestempelt · waiting',
      'nicht eingestempelt · waiting',
    ]);
  });

  test('another person or organization starts from nothing shown, also while the former clock waits', () => {
    let memory = advanceShownClock(NOTHING_SHOWN, { ...SETTLED, device: PENDING_START, deviceFrom: 30 });
    memory = advanceShownClock(memory, { ...SETTLED, deviceFrom: 40 });
    expect(memory.shown.settling).toBe(true);
    memory = advanceShownClock(memory, {
      ...SETTLED,
      scope: 'worker:other-company',
      server: null,
      online: false,
    });
    expect(seen(memory)).toBe('nichts');
    expect(memory.shown.settling).toBe(false);
  });

  test('a page whose device may hold unsent work shows nothing until the outbox answered', () => {
    const checking = { ...SETTLED, checkingDevice: true };
    expect(
      screens([
        checking,
        { ...checking, checkingDevice: false, device: PENDING_START, deviceFrom: 30 },
        { ...SETTLED, deviceFrom: 40 },
        { ...SETTLED, server: WORKING, serverFrom: 41, deviceFrom: 40 },
      ]),
    ).toEqual(['nichts', 'eingestempelt · sending', 'eingestempelt']);
  });

  test('settling unsent work blocks a new action until the server answered', () => {
    let memory = advanceShownClock(NOTHING_SHOWN, { ...SETTLED, device: PENDING_START, deviceFrom: 30 });
    memory = advanceShownClock(memory, { ...SETTLED, deviceFrom: 40 });
    expect(memory.shown.settling).toBe(true);
    memory = advanceShownClock(memory, { ...SETTLED, server: WORKING, serverFrom: 41, deviceFrom: 40 });
    expect(memory.shown.settling).toBe(false);
  });

  test('unchanged facts keep the same memory, so a render never loops', () => {
    const memory = advanceShownClock(NOTHING_SHOWN, SETTLED);
    expect(advanceShownClock(memory, { ...SETTLED })).toBe(memory);
  });
});
