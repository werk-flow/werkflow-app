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

  const { holdClock, sendOwnTimeEvents, takeInKept, timeUnsentSource } = await import('./clock-device');
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
      await holdClock(OTHER_COMPANY, () => undefined);
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
        await holdClock(WORKER, () => undefined);
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
      await holdClock(WORKER, () => undefined);
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
      await holdClock(WORKER, () => undefined);
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
      await holdClock(WORKER, () => undefined);
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
}
