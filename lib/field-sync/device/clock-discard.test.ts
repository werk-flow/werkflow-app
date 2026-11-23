import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';

import {
  CLOCKED_OUT,
  OTHER_COMPANY,
  WORKER,
  installTabLocks,
  resetDevice,
  storage,
} from '@/lib/testing/fixtures/time-outbox';
import { z } from '@/lib/zod';
import type { OutboxHolder } from './time-outbox-store';

// A discard after a session end's question (decision record 0010, the time outbox's invariant 6 and
// the amendment "a discard waits only for what it deletes", werk-flow/werkflow-planning#407): it
// waits for a send of the chain it deletes from and for a shown action's own online call, never for
// another chain's send or another action's call, and a stop that appeared after the question opened
// does not fail it. The tests replace the Supabase client module, so the file runs them in a
// `bun test` process of its own.

const ISOLATED_FLAG = 'CLOCK_DISCARD_ISOLATED_RUN';

if (process.env[ISOLATED_FLAG] === '1') await isolatedTests();
else
  test('a discard waits only for the sends and calls of what it deletes', async () => {
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
  let sends = 0;
  /** While set, every send waits for it: a request in flight. */
  let inFlight: Promise<void> | null = null;

  Object.assign(globalThis, {
    window: { addEventListener: () => undefined, removeEventListener: () => undefined },
    fetch: async (_url: string, init: RequestInit) => {
      sends += 1;
      if (inFlight) await inFlight;
      const { operations } = z
        .object({ operations: z.array(z.object({ operationId: z.string() })) })
        .parse(JSON.parse(String(init.body)));
      return Response.json({
        results: [
          {
            operationId: operations[0]?.operationId,
            outcome: 'accepted',
            code: 'accepted',
            state: { sessionId: null, segmentId: null, version: 1 },
          },
        ],
      });
    },
  });
  installTabLocks();
  void mock.module('@/lib/supabase/client', () => ({
    createSupabaseBrowserClient: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: WORKER.userId }, access_token: 'token-of-the-worker' } },
          error: null,
        }),
      },
    }),
  }));

  const {
    holdClock,
    removeShownTimeEvents,
    sendOwnTimeEvents,
    setAsideShownStop,
    takeInKept,
    timeUnsentSource,
  } = await import('./clock-device');
  const { clearTodayOnDevice } = await import('./today-wipe');
  const { callWhileKept, keepClockAction } = await import('./unsent-mark');
  const { readTimeOutbox } = await import('./time-outbox-store');

  beforeEach(async () => {
    setSystemTime(new Date('2026-11-11T12:00:00.000Z')); // The fixtures' day: a week on, they expire.
    sends = 0;
    await resetDevice();
  });

  /** A clock start of `holder` tapped at `capturedAt`, as a page keeps it before or instead of its online call. */
  const start = (holder: OutboxHolder, operationId: string, capturedAt: string) => ({
    ...holder,
    operationId,
    action: 'start',
    expectedSessionId: null,
    expectedVersion: null,
    selection: { kind: 'work' as const, allocationKind: 'unallocated' as const, jobId: null },
    base: { ...CLOCKED_OUT, organizationId: holder.organizationId },
    readAt: '2026-11-11T06:59:00.000Z',
    triedOnline: false,
    capturedAt,
  });

  /** An online call of `action` whose server has not answered; `answer` lets it answer. */
  function openCall(action: ReturnType<typeof start>): { answer: () => void; calling: Promise<unknown> } {
    let answer = (): void => undefined;
    const calling = callWhileKept(
      { ...action, triedOnline: true },
      '',
      () =>
        new Promise<void>((resolve) => {
          answer = resolve;
        }),
    );
    return { answer: () => answer(), calling };
  }

  /** The keys of the kept clock actions on the device. */
  function keptKeys(): string[] {
    return [...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock:'));
  }

  /** Lets queued tasks run until `done` answers true, as long as a discard needs when nothing holds it back. */
  async function settles(done: () => boolean): Promise<boolean> {
    for (let turn = 0; turn < 50 && !done(); turn += 1) await new Promise((resolve) => setImmediate(resolve));
    return done();
  }

  /** The ids of the work a question named, as the person was shown it. */
  function shownIds(items: { ids: readonly string[] }[]): string[] {
    return items.flatMap((item) => item.ids);
  }

  describe('a discard after the session end’s question', () => {
    test('waits only for a send of the chain it deletes from, never for another chain’s (F30)', async () => {
      // The person's start in the other organization waits in its outbox, and a tab sends it.
      await holdClock(OTHER_COMPANY, () => undefined, '');
      keepClockAction(
        start(OTHER_COMPANY, '50000000-0000-4000-8000-0000000000e0', '2026-11-11T07:00:00.000Z'),
        '',
      );
      await takeInKept();
      let release = (): void => undefined;
      inFlight = new Promise((resolve) => {
        release = resolve;
      });
      const sending = sendOwnTimeEvents();
      let discarding: Promise<void> = Promise.resolve();
      try {
        expect(await settles(() => sends === 1)).toBe(true);
        // The person switches away from the active organization, whose start waits too.
        await holdClock(WORKER, () => undefined, '');
        keepClockAction(
          start(WORKER, '50000000-0000-4000-8000-0000000000e1', '2026-11-11T07:01:00.000Z'),
          '',
        );
        await takeInKept();
        const shown = await timeUnsentSource.summarize('organization');
        expect(shownIds(shown)).toEqual(['50000000-0000-4000-8000-0000000000e1']);

        let discarded = false;
        discarding = timeUnsentSource.discard('organization', shownIds(shown)).then(() => {
          discarded = true;
        });
        expect(await settles(() => discarded)).toBe(true);
        expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      } finally {
        release();
        await Promise.all([sending, discarding]);
        inFlight = null;
      }
    });

    test('waits for a send of a tab still on the earlier version, which holds the one lock every chain shared (S1)', async () => {
      await holdClock(WORKER, () => undefined, '');
      keepClockAction(start(WORKER, '50000000-0000-4000-8000-0000000000e6', '2026-11-11T07:00:00.000Z'), '');
      await takeInKept();
      const shown = await timeUnsentSource.summarize('session');
      // A tab open across the deployment sends this chain under the earlier lock; the server has not answered.
      let answer = (): void => undefined;
      const earlierSend = navigator.locks.request(
        'werkflow-time-outbox',
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
          }),
      );

      let discarded = false;
      const discarding = timeUnsentSource.discard('session', shownIds(shown)).then(() => {
        discarded = true;
      });
      try {
        expect(await settles(() => discarded)).toBe(false);
      } finally {
        answer();
        await Promise.all([earlierSend, discarding]);
      }
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
    });

    test('deletes an action kept behind another chain’s open online call without waiting for that call (F30)', async () => {
      await holdClock(WORKER, () => undefined, '');
      // Another tab of the person, working in the other organization, waits for its online call.
      const other = openCall(
        start(OTHER_COMPANY, '50000000-0000-4000-8000-0000000000e2', '2026-11-11T07:00:00.000Z'),
      );
      keepClockAction(start(WORKER, '50000000-0000-4000-8000-0000000000e3', '2026-11-11T07:01:00.000Z'), '');
      const shown = await timeUnsentSource.summarize('organization');
      expect(shownIds(shown)).toEqual(['50000000-0000-4000-8000-0000000000e3']);

      let discarded = false;
      const discarding = timeUnsentSource.discard('organization', shownIds(shown)).then(() => {
        discarded = true;
      });
      try {
        expect(await settles(() => discarded)).toBe(true);
        // The shown tap is gone; the other organization's call still holds its own entry.
        expect(keptKeys()).toEqual([expect.stringContaining('0000000000e2')]);
      } finally {
        other.answer();
        await Promise.all([other.calling, discarding]);
      }
    });

    test('goes on when a stop appeared after the question opened: the shown work goes, and the stop is asked about anew (F31)', async () => {
      await holdClock(WORKER, () => undefined, '');
      const own = openCall(start(WORKER, '50000000-0000-4000-8000-0000000000e4', '2026-11-11T07:00:00.000Z'));
      keepClockAction(start(WORKER, '50000000-0000-4000-8000-0000000000e5', '2026-11-11T07:02:00.000Z'), '');
      const shown = await timeUnsentSource.summarize('session');
      expect(shown.map(({ label, count }) => [label, count])).toEqual([['Stempelzeiten', 2]]);

      // The open call answers, and meanwhile a tab of a newer version kept an action between the two.
      own.answer();
      await own.calling;
      const stop = `werkflow:unsent:clock:${String(Date.parse('2026-11-11T07:01:00.000Z')).padStart(15, '0')}:1:newer`;
      storage.set(stop, '{"version":2}');

      await timeUnsentSource.discard('session', shownIds(shown));

      expect(keptKeys()).toEqual([stop]);
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      // The question lists the new stop, which the person decides about anew.
      expect((await timeUnsentSource.summarize('session')).map(({ label }) => label)).toEqual([
        'Stempelzeiten, die diese App-Version nicht lesen kann',
      ]);
    });
  });

  describe('an unreadable record set aside (werk-flow/werkflow-planning#407 item 3)', () => {
    /** The key of a kept action tapped at `at`; under `prefix`, the kept store's or the set-aside one. */
    const keyAt = (at: string, operationId: string, prefix = 'werkflow:unsent:clock:') =>
      `${prefix}${String(Date.parse(at)).padStart(15, '0')}:1:${operationId}`;
    /** A record of a newer version: this version cannot read it. */
    const NEWER = JSON.stringify({ version: 2, userId: WORKER.userId, kind: 'new' });

    test('no longer holds the person’s later taps, and is never sent itself', async () => {
      const stop = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version');
      storage.set(stop, NEWER);
      keepClockAction(start(WORKER, '50000000-0000-4000-8000-0000000000f1', '2026-11-11T07:05:00.000Z'), '');
      let shown: { status: string } | null = null;
      await holdClock(
        WORKER,
        (view) => {
          shown = view;
        },
        '',
      );
      await sendOwnTimeEvents();
      // Behind the stop, the later tap waits kept and nothing leaves the phone.
      expect(sends).toBe(0);
      expect(keptKeys()).toHaveLength(2);

      expect(await setAsideShownStop(stop)).toBe('set_aside');

      // The later tap went as its own chain; the record stays on the phone, as it was, outside the kept store.
      expect(sends).toBe(1);
      expect(keptKeys()).toEqual([]);
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      const aside = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version', 'werkflow:unsent:clock-aside:');
      expect(storage.get(aside)).toBe(NEWER);
      await sendOwnTimeEvents();
      expect(sends).toBe(1);
      // The clock is no stopped chain: a tap without signal is kept again (clock-outbox-state.ts).
      expect(shown).toEqual(expect.objectContaining({ status: 'set_aside', events: [] }));
    });

    test('never brings back a stop another tab deleted while the move waited', async () => {
      const stop = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version');
      storage.set(stop, NEWER);
      await holdClock(WORKER, () => undefined, '');
      // Another tab, possibly of an earlier version, deletes the stop while this tab asks whether its call runs.
      const locks = navigator.locks;
      const request = locks.request.bind(locks);
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: {
          ...locks,
          request: (...args: Parameters<LockManager['request']>) => {
            if (args[0].startsWith('werkflow-clock-call:')) storage.delete(stop);
            return request(...args);
          },
        },
      });
      try {
        expect(await setAsideShownStop(stop)).toBe('gone');
      } finally {
        Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
      }

      expect([...storage.keys()].filter((key) => key.startsWith('werkflow:unsent:clock'))).toEqual([]);
    });

    test('is never taken in or sent, also by a version that can read it: the person settles it through the correction', async () => {
      const aside = keyAt(
        '2026-11-11T07:00:00.000Z',
        '50000000-0000-4000-8000-0000000000f2',
        'werkflow:unsent:clock-aside:',
      );
      keepClockAction(start(WORKER, '50000000-0000-4000-8000-0000000000f2', '2026-11-11T07:00:00.000Z'), '');
      // A record this version reads, as a later version would read the one a person set aside.
      const [kept] = keptKeys();
      storage.set(aside, storage.get(kept ?? '') ?? '');
      storage.delete(kept ?? '');
      await holdClock(WORKER, () => undefined, '');

      expect((await takeInKept()).moved).toBe(0);
      await sendOwnTimeEvents();

      expect(sends).toBe(0);
      expect((await readTimeOutbox(WORKER)).events).toEqual([]);
      expect(storage.has(aside)).toBe(true);
    });

    test('stays a stop while its online call may still run: its page may yet record it', async () => {
      const stop = keyAt('2026-11-11T11:59:58.000Z', 'from-a-newer-version');
      storage.set(stop, NEWER);
      await holdClock(WORKER, () => undefined, '');

      expect(await setAsideShownStop(stop)).toBe('sending');
      expect(keptKeys()).toEqual([stop]);
    });

    test('stays a stop past the grace period while its page still holds the clock call’s lock', async () => {
      const stop = keyAt('2026-11-11T07:00:00.000Z', 'call-still-open');
      storage.set(stop, NEWER);
      await holdClock(WORKER, () => undefined, '');
      // The page that tapped still waits for the server's answer, under the call's lock.
      let answer = (): void => undefined;
      let granted = (): void => undefined;
      const lockHeld = new Promise<void>((resolve) => {
        granted = resolve;
      });
      const openCall = navigator.locks.request(
        'werkflow-clock-call:call-still-open',
        () =>
          new Promise<void>((resolve) => {
            answer = resolve;
            granted();
          }),
      );
      await lockHeld;
      try {
        expect(await setAsideShownStop(stop)).toBe('sending');
        expect(keptKeys()).toEqual([stop]);
      } finally {
        answer();
        await openCall;
      }
    });

    test('is named by the session end’s question and deleted by its discard; the wipe leaves it', async () => {
      const stop = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version');
      storage.set(stop, NEWER);
      await holdClock(WORKER, () => undefined, '');
      await setAsideShownStop(stop);
      const aside = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version', 'werkflow:unsent:clock-aside:');

      // The wipe that ends a session never names unsent work: the question before it does.
      await clearTodayOnDevice();
      expect(storage.has(aside)).toBe(true);
      const shown = await timeUnsentSource.summarize('session');
      expect(shown.map(({ label, ids }) => [label, ids])).toEqual([
        ['Beiseitegelegte Stempelzeiten', [aside]],
      ]);

      await timeUnsentSource.discard('session', shownIds(shown));

      expect(storage.has(aside)).toBe(false);
      expect(await timeUnsentSource.summarize('session')).toEqual([]);
    });

    test('is deleted from the clock by the deletion the person confirmed', async () => {
      const stop = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version');
      storage.set(stop, NEWER);
      await holdClock(WORKER, () => undefined, '');
      await setAsideShownStop(stop);
      const aside = keyAt('2026-11-11T07:00:00.000Z', 'from-a-newer-version', 'werkflow:unsent:clock-aside:');

      await removeShownTimeEvents(WORKER, [aside], CLOCKED_OUT);

      expect(storage.has(aside)).toBe(false);
    });
  });
}
