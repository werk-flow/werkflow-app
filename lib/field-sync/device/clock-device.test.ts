import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { LiveClockState } from '@/lib/time-tracking/types';
import type { ClockDeviceView } from './time-outbox';
import { readTimeOutbox, type OutboxHolder } from './time-outbox-store';
import { TODAY_WIPE_KEY } from './today-wipe';

// This tab's hold on the time outbox (werk-flow/werkflow-planning#319): the
// envelope names no person, so only the device keeps one person's events out
// of another's session, and a sign-out never asks one person about another's.
// The tests replace the Supabase client module and the browser's globals, so
// the file runs them in a `bun test` process of its own.

const ISOLATED_FLAG = 'CLOCK_DEVICE_ISOLATED_RUN';

if (process.env[ISOLATED_FLAG] === '1') await isolatedTests();
else
  test('this tab’s hold on the time outbox keeps one person’s events out of another’s session', async () => {
    const child = Bun.spawn([process.execPath, 'test', import.meta.path], {
      cwd: `${import.meta.dir}/../../..`,
      env: { ...process.env, [ISOLATED_FLAG]: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
  });

async function isolatedTests(): Promise<void> {
  const storage = new Map<string, string>();
  const storageListeners: ((event: { key: string | null }) => void)[] = [];
  let sessionUserId: string | null = null;
  const sent: string[] = [];

  Object.assign(globalThis, {
    localStorage: {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => void storage.delete(key),
      setItem: (key: string, value: string) => void storage.set(key, value),
    },
    window: {
      addEventListener: (type: string, listener: (event: { key: string | null }) => void) => {
        if (type === 'storage') storageListeners.push(listener);
      },
      removeEventListener: () => undefined,
    },
    fetch: async (_url: string, init: RequestInit) => {
      const body: unknown = JSON.parse(String(init.body));
      sent.push(JSON.stringify(body));
      return Response.json({ outcome: 'retry', code: 'unavailable' }, { status: 503 });
    },
  });
  Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });

  void mock.module('@/lib/supabase/client', () => ({
    createSupabaseBrowserClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
          error: null,
        }),
      },
    }),
  }));

  const { holdClock, sendOwnTimeEvents, takeInKept, timeUnsentSource, clockHolder } = await import(
    './clock-device'
  );
  const { keepClockAction } = await import('./unsent-mark');

  const WORKER: OutboxHolder = {
    userId: '10000000-0000-4000-8000-00000000000a',
    organizationId: '20000000-0000-4000-8000-00000000000a',
  };
  const COLLEAGUE: OutboxHolder = { ...WORKER, userId: '10000000-0000-4000-8000-00000000000b' };
  const OTHER_COMPANY: OutboxHolder = { ...WORKER, organizationId: '20000000-0000-4000-8000-00000000000b' };

  const CLOCKED_OUT: LiveClockState = {
    organizationId: WORKER.organizationId,
    breakMode: 'manual',
    autoBreakThresholdMinutes: 360,
    autoBreakDurationMinutes: 30,
    status: 'clocked_out',
    isClockedIn: false,
    isOnBreak: false,
    clockInTime: null,
    statusStartedAt: null,
    breakStartTime: null,
    todayMinutes: 0,
    workMinutes: 0,
    breakMinutes: 0,
    timelineSegments: [],
    activeJobId: null,
    activeJobInfo: null,
    captureModel: 'none',
    sessionId: null,
    sessionVersion: null,
    currentSegmentId: null,
    currentActivity: null,
    resumeActivity: null,
    resumeJobInfo: null,
    recoveryReason: null,
    legacyOpen: false,
    standbyMinutes: 0,
    travelMinutes: 0,
    calloutMinutes: 0,
    internalMinutes: 0,
    fetchedAt: '2026-11-11T06:00:00.000Z',
  };

  let operations = 0;
  /** One clock start a page of this holder keeps without signal, taken into the outbox as its tab does. */
  async function keepStart(holder: OutboxHolder, views: (ClockDeviceView | null)[] = []): Promise<void> {
    operations += 1;
    await holdClock(holder, (view) => views.push(view));
    const kept = keepClockAction({
      ...holder,
      operationId: `50000000-0000-4000-8000-${String(operations).padStart(12, '0')}`,
      action: 'start',
      expectedSessionId: null,
      expectedVersion: null,
      selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
      base: { ...CLOCKED_OUT, organizationId: holder.organizationId },
      triedOnline: false,
    });
    expect(kept).toBe(true);
    await takeInKept();
  }

  beforeEach(async () => {
    storage.clear();
    sent.length = 0;
    sessionUserId = WORKER.userId;
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('werkflow-time-outbox');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('delete failed'));
    });
  });

  describe('this tab’s hold on the time outbox', () => {
    test('an action a page kept without signal is taken into its person’s outbox, shows as waiting, and leaves the start-up hint', async () => {
      const views: (ClockDeviceView | null)[] = [];

      await keepStart(WORKER, views);

      expect(views.at(-1)?.status).toBe('pending');
      expect(views.at(-1)?.state?.isClockedIn).toBe(true);
      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
      expect(storage.get('werkflow:unsent:time')).toBe('1');
      expect(storage.has('werkflow:unsent:clock')).toBe(false);
    });

    test('nothing is sent while the browser’s session belongs to someone else, or to nobody', async () => {
      await keepStart(WORKER);

      sessionUserId = COLLEAGUE.userId;
      await sendOwnTimeEvents();
      sessionUserId = null;
      await sendOwnTimeEvents();
      expect(sent).toEqual([]);

      sessionUserId = WORKER.userId;
      await sendOwnTimeEvents();
      expect(sent).toHaveLength(1);
      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
    });

    test('an action kept for another person goes into that person’s outbox, never into the tab holder’s', async () => {
      await keepStart(WORKER);
      keepClockAction({
        ...COLLEAGUE,
        operationId: '50000000-0000-4000-8000-0000000000ff',
        action: 'start',
        expectedSessionId: null,
        expectedVersion: null,
        selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
        base: CLOCKED_OUT,
        triedOnline: false,
      });
      await takeInKept();

      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
      expect((await readTimeOutbox(COLLEAGUE)).events).toHaveLength(1);
      await sendOwnTimeEvents();
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain('50000000-0000-4000-8000-0000000000ff');
    });

    test('an action that is no start, switch or end, or that this version cannot read, stays kept and is never dropped', async () => {
      await holdClock(WORKER, () => undefined);
      const unreadable = { operationId: 'from-a-newer-version' };
      storage.set('werkflow:unsent:clock', JSON.stringify([unreadable]));
      keepClockAction({
        ...WORKER,
        operationId: '50000000-0000-4000-8000-0000000000fe',
        action: 'recover_end',
        expectedSessionId: null,
        expectedVersion: null,
        selection: null,
        base: CLOCKED_OUT,
        triedOnline: false,
      });

      await takeInKept();

      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      const kept: unknown = JSON.parse(storage.get('werkflow:unsent:clock') ?? '[]');
      expect(kept).toHaveLength(2);
    });

    test('a sign-out is asked about the person’s own events of every organization, and discards only those', async () => {
      await keepStart(COLLEAGUE);
      await keepStart(OTHER_COMPANY);
      await keepStart(WORKER);

      expect(await timeUnsentSource.summarize()).toEqual([{ label: 'Stempelzeiten', count: 2 }]);
      await timeUnsentSource.discard();

      expect(await timeUnsentSource.summarize()).toEqual([]);
      expect((await readTimeOutbox(OTHER_COMPANY)).events).toEqual([]);
      expect((await readTimeOutbox(COLLEAGUE)).events).toHaveLength(1);
      // The colleague's event is still on the phone, so the next app start still loads the runner.
      expect(storage.get('werkflow:unsent:time')).toBe('1');
    });

    test('another tab’s sign-out or switch ends the hold: this tab shows, keeps and sends nothing more', async () => {
      const views: (ClockDeviceView | null)[] = [];
      await keepStart(WORKER, views);
      expect(clockHolder()).toEqual(WORKER);

      for (const listener of storageListeners) listener({ key: TODAY_WIPE_KEY });

      expect(views.at(-1)).toBeNull();
      expect(clockHolder()).toBeNull();
      await sendOwnTimeEvents();
      expect(sent).toEqual([]);
      // The event itself stays on the phone for the person's next page.
      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
    });
  });
}
