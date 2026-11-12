import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, mock, setSystemTime, spyOn, test } from 'bun:test';

import { z } from '@/lib/zod';
import type { ClockDeviceView } from './time-outbox';
import { readTimeOutbox, type OutboxHolder } from './time-outbox-store';
import {
  CLOCKED_OUT,
  COLLEAGUE,
  OTHER_COMPANY,
  WORKER,
  installTabLocks,
} from '@/lib/testing/fixtures/time-outbox';
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
  /** While set, every send waits for it: a request in flight. */
  let inFlight: Promise<void> | null = null;
  /** The server's verdict on each send; without one it asks to retry later. */
  let verdict: Record<string, unknown> | null = null;

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
      if (inFlight) await inFlight;
      const operationId = z.object({ operations: z.array(z.object({ operationId: z.string() })) }).parse(body)
        .operations[0]?.operationId;
      return verdict
        ? Response.json({ results: [{ operationId, ...verdict }] })
        : Response.json({ outcome: 'retry', code: 'unavailable' }, { status: 503 });
    },
  });
  Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
  installTabLocks();

  void mock.module('@/lib/supabase/client', () => ({
    createSupabaseBrowserClient: () => ({
      auth: {
        getSession: async () => ({
          data: {
            session:
              sessionUserId && !sessionUnreadable
                ? { user: { id: sessionUserId }, access_token: `token-of-${sessionUserId}` }
                : null,
          },
          error: sessionUnreadable ? new Error('The session could not be refreshed.') : null,
        }),
      },
    }),
  }));

  const {
    captureBehindKept,
    holdClock,
    sendOwnTimeEvents,
    takeInKept,
    timeUnsentSource,
    clockHolder,
    outboxChanged,
  } = await import('./clock-device');
  const { callWhileKept, keepClockAction } = await import('./unsent-mark');
  const { beginSessionEnd, endSessionEnd } = await import('./today-wipe');
  const { captureTimeEvent } = await import('./time-outbox');

  /** The server's answer that records an event. */
  const ACCEPTED = {
    outcome: 'accepted',
    code: 'accepted',
    state: { sessionId: null, segmentId: null, version: 1 },
  };

  let operations = 0;
  /** A clock start a page keeps without signal, under the operation id `operationId`. */
  const startAction = (operationId: string) => ({
    version: 1 as const,
    ...WORKER,
    operationId,
    action: 'start',
    expectedSessionId: null,
    expectedVersion: null,
    selection: { kind: 'work' as const, allocationKind: 'unallocated' as const, jobId: null },
    base: CLOCKED_OUT,
    readAt: '2026-11-11T06:59:00.000Z',
    triedOnline: false,
    capturedAt: '2026-11-11T07:00:00.000Z',
  });

  /** A clock action the page without signal captures at `at`, under the current wipe signal. */
  const offlineCapture = (operationId: string, action: 'start' | 'end', at: string) => ({
    command: {
      operationId,
      action,
      expectedSessionId: null,
      expectedVersion: null,
      selection:
        action === 'end'
          ? null
          : { kind: 'work' as const, allocationKind: 'unallocated' as const, jobId: null },
    },
    base: null,
    readAt: null,
    capturedAt: new Date(at),
    triedOnline: false,
    wipeGeneration: '',
  });

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
        readAt: '2026-11-11T06:59:00.000Z',
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

  /** Lets every task queued so far run: no timed wait. */
  function nextTask(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  /** The ids of the events a question named, as the person was shown them. */
  function shownIds(items: { ids: readonly string[] }[]): string[] {
    return items.flatMap((item) => item.ids);
  }

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
          readAt: '2026-11-11T06:59:00.000Z',
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

    test('an action this version cannot read that names no person is a stop the person sees, is asked about, and is discarded with what it held (F2, F29)', async () => {
      const key = 'werkflow:unsent:clock:000000000000001:1:from-a-newer-version';
      storage.set(key, '{"operationId":"x","kind":"new"}');
      const views: (ClockDeviceView | null)[] = [];
      await holdClock(WORKER, (view) => views.push(view));
      keepClockAction(startAction('50000000-0000-4000-8000-0000000000d8'), ''); // the person's own tap, behind it
      expect((await takeInKept()).stops).toEqual([{ userId: null, at: 1 }]);
      await outboxChanged();
      expect(views.at(-1)?.events.map(({ status }) => status)).toEqual(['unreadable']);
      // The sign-out question names both instead of failing, so the person can go on after deciding.
      const items = await timeUnsentSource.summarize('session');
      expect(items.map(({ label, count }) => [label, count])).toEqual([
        ['Stempelzeiten', 1],
        ['Stempelzeiten, die diese App-Version nicht lesen kann', 1],
      ]);
      // „Endgültig verwerfen“ finishes: the stop goes first, so the tap it held is taken in and discarded.
      await timeUnsentSource.discard(
        'session',
        items.flatMap(({ ids }) => ids),
      );
      expect([...storage.keys()].filter((stored) => stored.startsWith('werkflow:unsent:clock:'))).toEqual([]);
      expect(await timeUnsentSource.summarize('session')).toEqual([]);
    });

    test('another person’s unreadable action holds only that person: this person’s taps are taken in and sent (F2)', async () => {
      sessionUserId = WORKER.userId;
      verdict = ACCEPTED;
      const theirs = 'werkflow:unsent:clock:000000000000001:1:colleagues-newer-version';
      storage.set(theirs, JSON.stringify({ userId: COLLEAGUE.userId, version: 2 }));
      await holdClock(WORKER, () => undefined);

      keepClockAction(startAction('50000000-0000-4000-8000-0000000000d7'), '');
      await sendOwnTimeEvents();

      expect(sent).toHaveLength(1);
      expect(await timeUnsentSource.summarize('session')).toEqual([]);
      expect(storage.has(theirs)).toBe(true);
      verdict = null;
    });

    test('the page without signal takes the other tabs’ kept actions in before its own, so an earlier tap stays first', async () => {
      await holdClock(WORKER, () => undefined);
      keepClockAction(
        {
          ...WORKER,
          operationId: '50000000-0000-4000-8000-0000000000c1',
          action: 'start',
          expectedSessionId: null,
          expectedVersion: null,
          selection: { kind: 'work', allocationKind: 'unallocated', jobId: null },
          base: CLOCKED_OUT,
          readAt: '2026-11-11T09:59:00.000Z',
          triedOnline: false,
          capturedAt: '2026-11-11T10:00:00.000Z',
        },
        '',
      );

      await captureBehindKept(
        WORKER,
        offlineCapture('50000000-0000-4000-8000-0000000000c2', 'end', '2026-11-11T10:05:00.000Z'),
      );

      expect((await readTimeOutbox(WORKER)).events.map((event) => event.operationId)).toEqual([
        '50000000-0000-4000-8000-0000000000c1',
        '50000000-0000-4000-8000-0000000000c2',
      ]);
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
        base: CLOCKED_OUT,
        triedOnline: false,
        readAt: '2026-11-11T06:59:00.000Z',
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
            readAt: '2026-11-11T06:59:00.000Z',
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

      const shown = await timeUnsentSource.summarize();
      expect(shown).toEqual([expect.objectContaining({ label: 'Stempelzeiten', count: 2 })]);
      await timeUnsentSource.discard('session', shownIds(shown));

      expect(await timeUnsentSource.summarize()).toEqual([]);
      expect((await readTimeOutbox(OTHER_COMPANY)).events).toEqual([]);
      expect((await readTimeOutbox(COLLEAGUE)).events).toHaveLength(1);
      // The colleague's event is still on the phone, so the next app start still loads the runner.
      expect(storage.get('werkflow:unsent:time')).toBe('1');
    });

    test('a sign-out counts an online call still open and every action kept behind it, never „nothing unsent“', async () => {
      sessionUserId = WORKER.userId;
      await holdClock(WORKER, () => undefined);
      let answer = (): void => undefined;
      const calling = callWhileKept(
        { ...startAction('50000000-0000-4000-8000-0000000000b2'), triedOnline: true },
        '',
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
          }),
      );
      keepClockAction(
        { ...startAction('50000000-0000-4000-8000-0000000000b3'), capturedAt: '2026-11-11T07:01:00.000Z' },
        '',
      );

      expect(await timeUnsentSource.summarize('session')).toEqual([
        {
          label: 'Stempelzeiten',
          count: 2,
          ids: ['50000000-0000-4000-8000-0000000000b2', '50000000-0000-4000-8000-0000000000b3'],
        },
      ]);
      answer();
      await calling;
    });

    test('a discard deletes exactly the events the person was shown; one kept after the question stays and is asked about', async () => {
      await keepStart(WORKER);
      const shown = await timeUnsentSource.summarize();
      await keepStart(WORKER);

      await timeUnsentSource.discard('session', shownIds(shown));

      expect(await timeUnsentSource.summarize()).toEqual([
        expect.objectContaining({ label: 'Stempelzeiten', count: 1 }),
      ]);
    });

    test('the start-up hint is set before a kept action’s key goes, so a tab closed mid-intake still sends at the next start', async () => {
      storage.delete('werkflow:unsent:time');
      const hintAtRemoval: (string | undefined)[] = [];
      const { removeItem } = localStorage;
      localStorage.removeItem = (key: string) => {
        if (key.startsWith('werkflow:unsent:clock:')) hintAtRemoval.push(storage.get('werkflow:unsent:time'));
        removeItem(key);
      };
      await keepStart(WORKER);
      localStorage.removeItem = removeItem;

      expect(hintAtRemoval).toEqual(['1']);
    });

    test('a full storage that cannot hold the start-up hint keeps the action’s key, so the next start still finds it', async () => {
      storage.delete('werkflow:unsent:time');
      keepClockAction(startAction('50000000-0000-4000-8000-0000000000a8'), '');
      const { setItem } = localStorage;
      localStorage.setItem = (key: string, value: string) => {
        if (key === 'werkflow:unsent:time')
          throw new DOMException('The quota is exceeded.', 'QuotaExceededError');
        setItem(key, value);
      };
      try {
        await expect(takeInKept()).rejects.toThrow();
      } finally {
        localStorage.setItem = setItem;
      }
      expect([...storage.keys()].filter((key) => key.includes('0000000000a8'))).toHaveLength(1);
    });

    test('an action another tab kept is taken in and sent here, also when that tab closed before it sent', async () => {
      sessionUserId = WORKER.userId;
      verdict = ACCEPTED;
      await holdClock(WORKER, () => undefined);
      keepClockAction(startAction('50000000-0000-4000-8000-0000000000b1'), '');
      const key = [...storage.keys()].find((stored) => stored.startsWith('werkflow:unsent:clock:')) ?? null;

      for (const listener of storageListeners) listener({ key });
      for (let turn = 0; turn < 50 && sent.length === 0; turn += 1) await nextTask();

      expect(sent).toHaveLength(1);
      verdict = null;
    });

    test('an online call’s action is written down first and left to its page while the call runs; one kept behind it waits', async () => {
      sessionUserId = WORKER.userId;
      await holdClock(WORKER, () => undefined);
      const action = (operationId: string, capturedAt: string) => ({
        ...WORKER,
        operationId,
        action: 'start',
        expectedSessionId: null,
        expectedVersion: null,
        selection: { kind: 'work' as const, allocationKind: 'unallocated' as const, jobId: null },
        base: CLOCKED_OUT,
        readAt: '2026-11-11T06:59:00.000Z',
        triedOnline: true,
        capturedAt,
      });
      let answer = (): void => undefined;
      const calling = callWhileKept(
        action('50000000-0000-4000-8000-0000000000a1', '2026-11-11T07:00:00.000Z'),
        '',
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
          }),
      );
      await nextTask();
      expect([...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:'))).toHaveLength(1);
      // Another tab kept a later action meanwhile.
      keepClockAction(
        { ...action('50000000-0000-4000-8000-0000000000a2', '2026-11-11T07:01:00.000Z'), triedOnline: false },
        '',
      );

      await takeInKept();
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);

      answer();
      await calling;
      expect([...storage.keys()].filter((key) => key.includes('0000000000a1'))).toEqual([]);
      await takeInKept();
      expect((await readTimeOutbox(WORKER)).events.map((event) => event.operationId)).toEqual([
        '50000000-0000-4000-8000-0000000000a2',
      ]);
    });

    test('the page without signal keeps its action behind an online call another tab still holds open', async () => {
      sessionUserId = WORKER.userId;
      await holdClock(WORKER, () => undefined);
      let answer = (): void => undefined;
      const calling = callWhileKept(
        { ...startAction('50000000-0000-4000-8000-0000000000b4'), triedOnline: true },
        '',
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
          }),
      );

      await captureBehindKept(
        WORKER,
        offlineCapture('50000000-0000-4000-8000-0000000000b5', 'end', '2026-11-11T07:05:00.000Z'),
      );

      // Nothing jumped ahead of the open call: the end waits in the kept store, behind it.
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      expect(
        [...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:')).toSorted(),
      ).toEqual([expect.stringContaining('0000000000b4'), expect.stringContaining('0000000000b5')]);
      answer();
      await calling;
    });

    test('neither a tap nor a send passes a kept action this version cannot read (S24)', async () => {
      sessionUserId = WORKER.userId;
      verdict = ACCEPTED;
      await holdClock(WORKER, () => undefined);
      // At 12:00 a newer version kept a break; 07:00 a start, and 13:00 an end an earlier path put into the outbox.
      storage.set('werkflow:unsent:clock:001794398400000:1:from-a-newer-version', '{"version":2}');
      const at = (time: string, id: string) =>
        offlineCapture(
          `50000000-0000-4000-8000-0000000000${id}`,
          id === 'c1' ? 'start' : 'end',
          `2026-11-11T${time}Z`,
        );
      await captureTimeEvent(WORKER, at('07:00', 'c1'));
      await captureTimeEvent(WORKER, at('13:00', 'c2'));

      await captureBehindKept(WORKER, at('14:00', 'c3'));
      await sendOwnTimeEvents();

      // Only the start before the stop is recorded: no span runs from 07:00 over the break the server never saw.
      expect(sent.map((body) => body.includes('0000000000c1'))).toEqual([true]);
      expect((await readTimeOutbox(WORKER)).events.map(({ operationId }) => operationId.slice(-2))).toEqual([
        'c2',
      ]);
      expect([...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:'))).toEqual([
        'werkflow:unsent:clock:001794398400000:1:from-a-newer-version',
        expect.stringContaining('0000000000c3'),
      ]);
      verdict = null;
    });

    test('an entry of a page that closed mid-call and is still young is taken in once it ages out, without another trigger', async () => {
      sessionUserId = WORKER.userId;
      await holdClock(WORKER, () => undefined);
      setSystemTime(new Date('2026-11-11T07:00:01.000Z'));
      // The page closed a second after its tap; this tab opens at once.
      storage.set(
        'werkflow:unsent:clock:001762844400000:1:50000000-0000-4000-8000-0000000000a9',
        JSON.stringify({
          ...startAction('50000000-0000-4000-8000-0000000000a9'),
          triedOnline: true,
          inFlight: true,
          wipeGeneration: '',
        }),
      );
      const timers = spyOn(globalThis, 'setTimeout');
      try {
        await takeInKept();
        expect((await readTimeOutbox(WORKER)).events).toEqual([]);
        // The look again, nine seconds on, once the entry is old enough to judge.
        const index = timers.mock.calls.findIndex(([, delay]) => delay === 9_000);
        const [lookAgain] = timers.mock.calls[index] ?? [];
        if (typeof lookAgain !== 'function') throw new Error('no later take-in was scheduled');
        // The real timer would fire after the test; this test runs the look itself.
        const scheduled = timers.mock.results[index];
        if (scheduled?.type === 'return') clearTimeout(scheduled.value);

        setSystemTime(new Date('2026-11-11T07:00:12.000Z'));
        lookAgain();
        for (let turn = 0; turn < 50 && (await readTimeOutbox(WORKER)).events.length === 0; turn += 1)
          await nextTask();
        expect((await readTimeOutbox(WORKER)).events.map((event) => event.operationId)).toEqual([
          '50000000-0000-4000-8000-0000000000a9',
        ]);
      } finally {
        timers.mockRestore();
        setSystemTime();
      }
    });

    test('the action of a page that closed mid-call is taken in at the next start under the same operation id', async () => {
      sessionUserId = WORKER.userId;
      await holdClock(WORKER, () => undefined);
      // What a page left when it closed before the answer: the entry, and no lock any more.
      storage.set(
        'werkflow:unsent:clock:001762844400000:1:50000000-0000-4000-8000-0000000000a3',
        JSON.stringify({
          ...startAction('50000000-0000-4000-8000-0000000000a3'),
          triedOnline: true,
          inFlight: true,
          wipeGeneration: '',
        }),
      );

      await takeInKept();

      expect((await readTimeOutbox(WORKER)).events).toEqual([
        expect.objectContaining({ operationId: '50000000-0000-4000-8000-0000000000a3', triedOnline: true }),
      ]);
    });

    test('while a session end makes its last check no tab keeps or calls; each end lifts only its own barrier', async () => {
      const first = beginSessionEnd(); // Two sign-outs in other tabs, on this tab's storage.
      const second = beginSessionEnd();
      expect(keepClockAction(startAction('50000000-0000-4000-8000-0000000000a4'), '')).toBeNull();
      let called = false;
      const tap = callWhileKept(
        { ...startAction('50000000-0000-4000-8000-0000000000b6'), triedOnline: true },
        '',
        async () => {
          called = true;
        },
      );
      await expect(tap).rejects.toThrow();
      expect(called).toBe(false);
      // The person stays in the first tab: the second end still holds.
      endSessionEnd(first);
      expect(keepClockAction(startAction('50000000-0000-4000-8000-0000000000a6'), '')).toBeNull();
      endSessionEnd(second);
      expect(keepClockAction(startAction('50000000-0000-4000-8000-0000000000a6'), '')?.kept).toBe(true);
    });

    test('the page without signal keeps nothing while a session end makes its last check', async () => {
      const flow = beginSessionEnd();
      await expect(
        captureTimeEvent(
          WORKER,
          offlineCapture('50000000-0000-4000-8000-0000000000a7', 'start', '2026-11-11T07:00:00.000Z'),
          { underSignal: true },
        ),
      ).rejects.toThrow();
      endSessionEnd(flow);
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
    });

    test('a barrier whose tab closed mid-question lapses, so no tab is kept from keeping for good', () => {
      // The asking tab closed 11 minutes ago without clearing it.
      setSystemTime(new Date('2026-11-11T08:00:00.000Z'));
      storage.set('werkflow:session-ending', String(Date.parse('2026-11-11T07:49:00.000Z')));
      expect(keepClockAction(startAction('50000000-0000-4000-8000-0000000000a5'), '')?.kept).toBe(true);
      setSystemTime();
    });

    /** Starts a send that waits on the server, discards what the person was shown, and answers whether the discard finished before the send. */
    async function discardDuringSend(): Promise<boolean> {
      sessionUserId = WORKER.userId;
      await keepStart(WORKER);
      const shown = await timeUnsentSource.summarize();
      let release = (): void => undefined;
      inFlight = new Promise((resolve) => {
        release = resolve;
      });
      verdict = ACCEPTED;
      try {
        const sending = sendOwnTimeEvents();
        await nextTask();
        let discarded = false;
        const discarding = timeUnsentSource.discard('session', shownIds(shown)).then(() => {
          discarded = true;
        });
        // As long as a discard needs to finish when nothing holds it back.
        for (let turn = 0; turn < 50 && !discarded; turn += 1) await nextTask();
        const early = discarded;
        release();
        await Promise.all([sending, discarding]);
        return early;
      } finally {
        inFlight = null;
        verdict = null;
      }
    }

    test('a discard waits for a send in flight, so the server never records an event the person was told is gone', async () => {
      expect(await discardDuringSend()).toBe(false);
      expect(sent).toHaveLength(1);
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
    });

    test('without Web Locks a discard still waits for this tab’s send in flight', async () => {
      const locks = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
      Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: undefined });
      try {
        expect(await discardDuringSend()).toBe(false);
        expect(sent).toHaveLength(1);
      } finally {
        if (locks) Object.defineProperty(globalThis.navigator, 'locks', locks);
      }
    });

    test('a switch asks only about the organization it leaves, so the other organization’s events stay for when the person works there', async () => {
      await keepStart(OTHER_COMPANY);
      // The tab works in WORKER's organization; the person also has an unsent event in another one.
      await keepStart(WORKER);

      const shown = await timeUnsentSource.summarize('organization');
      expect(shown).toEqual([expect.objectContaining({ label: 'Stempelzeiten', count: 1 })]);
      await timeUnsentSource.discard('organization', shownIds(shown));

      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      expect((await readTimeOutbox(OTHER_COMPANY)).events).toHaveLength(1);
      expect(await timeUnsentSource.summarize('organization')).toEqual([]);
      // A sign-out still names it, since it ends every organization's session.
      expect(await timeUnsentSource.summarize()).toEqual([
        expect.objectContaining({ label: 'Stempelzeiten', count: 1 }),
      ]);
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
