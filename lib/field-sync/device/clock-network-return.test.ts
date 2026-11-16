import 'fake-indexeddb/auto';

import { beforeEach, expect, mock, setSystemTime, test } from 'bun:test';

import {
  WORKER,
  capture,
  command,
  installTabLocks,
  keptIds,
  resetDevice,
  sentBodySchema,
} from '@/lib/testing/fixtures/time-outbox';

// The network's return and a send in flight (decision record 0010, the amendment "the network's
// return ends a send that hangs", werk-flow/werkflow-planning#407): a send that left in a dead spot
// never answers by itself, and it must not hold back the send the return starts. The tests replace
// the Supabase client module and the browser's globals, so the file runs them in a `bun test`
// process of its own.

const ISOLATED_FLAG = 'CLOCK_NETWORK_RETURN_ISOLATED_RUN';

if (process.env[ISOLATED_FLAG] === '1') await isolatedTests();
else
  test('the network’s return sends what waits, also past a send that hangs', async () => {
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
  /** The operation id of each request the server got, or that left without reaching it. */
  const sent: string[] = [];
  /** While set, a request never answers, as in a dead spot; like a browser's, it fails once aborted. */
  let deadSpot = false;
  const onlineListeners: (() => void)[] = [];

  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'online') onlineListeners.push(listener);
      },
      removeEventListener: () => undefined,
    },
    fetch: async (_url: string, init: RequestInit) => {
      const [envelope] = sentBodySchema.parse(JSON.parse(String(init.body))).operations;
      sent.push(envelope?.operationId ?? '');
      if (deadSpot)
        return new Promise<Response>((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
      return Response.json({
        results: [
          {
            operationId: envelope?.operationId,
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

  const { sendOwnTimeEvents } = await import('./clock-device');
  const { registerSender, startSyncRunner } = await import('./sync-runner');

  beforeEach(async () => {
    setSystemTime(new Date('2026-11-11T12:00:00.000Z')); // The fixtures' day: a week on, they expire.
    await resetDevice();
  });

  /** Lets queued tasks run until `done` answers true: IndexedDB events and locks only, no clock. */
  async function settles(done: () => boolean): Promise<boolean> {
    for (let turn = 0; turn < 100 && !done(); turn += 1)
      await new Promise((resolve) => setImmediate(resolve));
    return done();
  }

  test('a send left hanging in a dead spot never holds back the send when the network returns', async () => {
    const start = command('start');
    await capture(WORKER, start);
    registerSender('time', sendOwnTimeEvents);
    deadSpot = true;
    const pass = startSyncRunner();
    expect(await settles(() => sent.length === 1)).toBe(true);

    // The signal is back; the request that left in the dead spot never answers by itself.
    deadSpot = false;
    for (const listener of onlineListeners) listener();

    expect(await settles(() => sent.length === 2)).toBe(true);
    await pass;
    // The same event again, unchanged: the server records it once.
    expect(sent).toEqual([start.operationId, start.operationId]);
    expect(await keptIds(WORKER)).toEqual([]);
  });
}
