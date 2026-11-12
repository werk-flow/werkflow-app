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
  /** The browser cannot read its session, as with an expired token and no network. */
  let sessionUnreadable = false;
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
          data: { session: sessionUserId && !sessionUnreadable ? { user: { id: sessionUserId } } : null },
          error: sessionUnreadable ? new Error('The session could not be refreshed.') : null,
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
    const kept = keepClockAction(
      {
        ...holder,
        operationId: `50000000-0000-4000-8000-${String(operations).padStart(12, '0')}`,
        action: 'start',
        expectedSessionId: null,
        expectedVersion: null,
        selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
        base: { ...CLOCKED_OUT, organizationId: holder.organizationId },
        triedOnline: false,
        capturedAt: '2026-11-11T07:00:00.000Z',
      },
      '',
    );
    expect(kept?.kept).toBe(true);
    await takeInKept();
  }

  beforeEach(async () => {
    storage.clear();
    sent.length = 0;
    sessionUserId = WORKER.userId;
    sessionUnreadable = false;
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
      expect([...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:'))).toEqual([]);
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

    test('a session that cannot be read sends nothing', async () => {
      await keepStart(WORKER);
      sessionUnreadable = true;

      await expect(sendOwnTimeEvents()).rejects.toThrow('The session could not be refreshed.');

      expect(sent).toEqual([]);
      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
    });

    test('an action kept for another person goes into that person’s outbox, never into the tab holder’s', async () => {
      await keepStart(WORKER);
      keepClockAction(
        {
          ...COLLEAGUE,
          operationId: '50000000-0000-4000-8000-0000000000ff',
          action: 'start',
          expectedSessionId: null,
          expectedVersion: null,
          selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
          base: CLOCKED_OUT,
          triedOnline: false,
          capturedAt: '2026-11-11T07:01:00.000Z',
        },
        '',
      );
      await takeInKept();

      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
      expect((await readTimeOutbox(COLLEAGUE)).events).toHaveLength(1);
      await sendOwnTimeEvents();
      expect(sent).toHaveLength(1);
      expect(sent[0]).not.toContain('50000000-0000-4000-8000-0000000000ff');
    });

    test('an action this version cannot read stays kept, and the sign-out question fails instead of answering „nothing unsent“', async () => {
      await holdClock(WORKER, () => undefined);
      storage.set(
        'werkflow:unsent:clock:000000000000001:1:from-a-newer-version',
        '{"operationId":"x","kind":"new"}',
      );

      expect(await takeInKept()).toEqual({ unreadable: 1 });
      await expect(timeUnsentSource.summarize()).rejects.toThrow('cannot be read');

      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      expect(storage.has('werkflow:unsent:clock:000000000000001:1:from-a-newer-version')).toBe(true);
    });

    test('two actions kept at once are two keys, so neither overwrites the other, and they are taken in in the order of their taps', async () => {
      await holdClock(WORKER, () => undefined);
      const action = (operation: string, capturedAt: string, kind: 'start' | 'end') => ({
        ...WORKER,
        operationId: operation,
        action: kind,
        expectedSessionId: null,
        expectedVersion: null,
        selection:
          kind === 'end'
            ? null
            : { kind: 'work' as const, allocationKind: 'unallocated' as const, jobId: null },
        base: kind === 'start' ? CLOCKED_OUT : null,
        triedOnline: false,
        capturedAt,
      });
      // The later tap is written first, as another tab's write can land first.
      expect(
        keepClockAction(action('50000000-0000-4000-8000-0000000000e2', '2026-11-11T08:00:00.000Z', 'end'), '')
          ?.kept,
      ).toBe(true);
      expect(
        keepClockAction(
          action('50000000-0000-4000-8000-0000000000e1', '2026-11-11T07:00:00.000Z', 'start'),
          '',
        )?.kept,
      ).toBe(true);

      await takeInKept();

      expect((await readTimeOutbox(WORKER)).events.map((event) => [event.action, event.capturedAt])).toEqual([
        ['start', '2026-11-11T07:00:00.000Z'],
        ['end', '2026-11-11T08:00:00.000Z'],
      ]);
      expect([...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:'))).toEqual([]);
    });

    test('a page whose wipe signal another tab changed keeps nothing more: its person may have signed out', async () => {
      storage.set('werkflow:today-wiped', 'signal-of-this-page');
      const kept = (signal: string) =>
        keepClockAction(
          {
            ...WORKER,
            operationId: '50000000-0000-4000-8000-0000000000d1',
            action: 'start',
            expectedSessionId: null,
            expectedVersion: null,
            selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
            base: CLOCKED_OUT,
            triedOnline: false,
            capturedAt: '2026-11-11T07:00:00.000Z',
          },
          signal,
        );

      // Another tab signed out: the signal moved on.
      storage.set('werkflow:today-wiped', 'signal-of-the-sign-out');

      expect(kept('signal-of-this-page')).toBeNull();
      expect([...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:'))).toEqual([]);
      expect(kept('signal-of-the-sign-out')?.kept).toBe(true);
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

    // Last: a wipe ends this module's hold for the rest of the process, as for the rest of a tab's life.
    test('another tab’s sign-out ends the hold, also during a read: the tab shows nothing and sends nothing without the person’s session', async () => {
      const views: (ClockDeviceView | null)[] = [];
      await keepStart(WORKER, views);
      expect(clockHolder()).toEqual(WORKER);

      // Another tab changed the outbox, so this tab reads it; the sign-out lands during that read.
      for (const listener of storageListeners) listener({ key: 'werkflow:time-outbox-changed' });
      for (const listener of storageListeners) listener({ key: TODAY_WIPE_KEY });
      // Lets the read finish: queued tasks and IndexedDB events only, no clock.
      for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      sessionUserId = null;

      expect(views.at(-1)).toBeNull();
      expect(clockHolder()).toBeNull();
      await sendOwnTimeEvents();
      expect(sent).toEqual([]);
      // The event itself stays on the phone for the person's next page.
      expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
      // Without a hold the sign-out question asks the session; one it cannot read fails the
      // question instead of answering that nothing is unsent.
      sessionUnreadable = true;
      await expect(timeUnsentSource.summarize()).rejects.toThrow('The session could not be refreshed.');

      // A page without a hold, such as the password reset page, sends the session person's chain.
      sessionUnreadable = false;
      sessionUserId = WORKER.userId;
      await sendOwnTimeEvents();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain(WORKER.organizationId);
    });
  });
}
