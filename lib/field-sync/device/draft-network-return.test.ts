import 'fake-indexeddb/auto';

import { beforeEach, expect, mock, setSystemTime, test } from 'bun:test';

import { z } from '@/lib/zod';
import {
  WORKER,
  capture,
  command,
  deleteDatabase,
  installTabLocks,
  keptIds,
  resetDevice,
} from '@/lib/testing/fixtures/time-outbox';
import type { StoredDraft } from './draft-store';

// The network's return and a report draft's send in flight (decision record 0010, the amendment
// "the network's return ends a send that hangs", werk-flow/werkflow-planning#407): a draft's attach
// request or photo upload that left in a dead spot never answers by itself, and it must not hold
// back the time events the return sends in the same pass. The tests replace the Supabase client,
// the upload path and the browser's globals, so the file runs them in a `bun test` process of its own.

const ISOLATED_FLAG = 'DRAFT_NETWORK_RETURN_ISOLATED_RUN';

if (process.env[ISOLATED_FLAG] === '1') await isolatedTests();
else
  test('the network’s return sends the time events behind a draft send that hangs', async () => {
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
  /** The operation id of each request by kind, also of one that left without reaching the server. */
  const sent: { kind: string; operationId: string }[] = [];
  /** How many photo uploads began, and whether each one's signal was aborted once it ended. */
  let uploadsBegun = 0;
  const uploadsAborted: boolean[] = [];
  /** While set, a request or upload never answers, as in a dead spot; like a browser's, it fails once aborted. */
  let deadSpot = false;
  const onlineListeners: (() => void)[] = [];

  /** Resolves with `answer` once `signal` aborts; never while it does not. */
  function hangUntilAborted<T>(
    signal: AbortSignal | null | undefined,
    answer: () => T | Promise<T>,
  ): Promise<T> {
    return new Promise<T>((resolve) => signal?.addEventListener('abort', () => resolve(answer())));
  }

  const operationsSchema = z.object({
    operations: z.array(z.object({ operationId: z.string(), kind: z.string() })).length(1),
  });

  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'online') onlineListeners.push(listener);
      },
      removeEventListener: () => undefined,
    },
    fetch: async (_url: string, init: RequestInit) => {
      const [envelope] = operationsSchema.parse(JSON.parse(String(init.body))).operations;
      if (!envelope) throw new Error('one operation per request');
      sent.push(envelope);
      if (deadSpot)
        return hangUntilAborted(init.signal, () =>
          Promise.reject<Response>(new DOMException('aborted', 'AbortError')),
        );
      const state = { sessionId: null, segmentId: null, version: 1 };
      return Response.json({
        results: [{ operationId: envelope.operationId, outcome: 'accepted', code: 'accepted', state }],
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
  void mock.module('@/lib/data/background-read-client', () => ({
    readInBackground: async () => ({ success: true }),
  }));
  void mock.module('@/lib/documents/upload-client', () => ({
    uploadDocumentDirect: async ({ signal }: { signal?: AbortSignal }) => {
      uploadsBegun += 1;
      const answer = deadSpot
        ? await hangUntilAborted(signal, () => ({
            status: 'failed' as const,
            reason: 'interrupted' as const,
            transferred: null,
          }))
        : { status: 'saved' as const, saved: { id: PHOTO_DOCUMENT_ID } };
      uploadsAborted.push(signal?.aborted ?? false);
      return answer;
    },
  }));

  const { sendOwnTimeEvents } = await import('./clock-device');
  const { changeDraftOnDevice, listDraftsOnDevice } = await import('./draft-store');
  const { sendDrafts, startDraftSync } = await import('./draft-sync');
  const { registerSender, startSyncRunner } = await import('./sync-runner');

  const DRAFT_OPERATION_ID = '60000000-0000-4000-8000-000000000012';
  const PHOTO_DOCUMENT_ID = '60000000-0000-4000-8000-000000000040';
  const draft = {
    ...WORKER,
    id: '60000000-0000-4000-8000-000000000010',
    revisionId: '60000000-0000-4000-8000-000000000011',
    operationId: DRAFT_OPERATION_ID,
    jobId: '60000000-0000-4000-8000-000000000020',
    kind: 'work_report' as const,
    visibility: 'internal_only' as const,
    capturedAt: '2026-11-11T07:30:00.000Z',
    title: 'Heizung gewartet',
    content: { performedWork: 'Brenner gereinigt' },
    photos: [],
    ready: true,
    updatedAt: '2026-11-11T07:45:00.000Z',
    sealed: false,
    refusal: null,
  };
  const photo: StoredDraft['photos'][number] = {
    id: '60000000-0000-4000-8000-000000000031',
    name: 'foto-1.jpg',
    blob: new Blob(['synthetic foto-1.jpg'], { type: 'image/jpeg' }),
    transferred: null,
    documentId: null,
  };

  /** Whether a pass of the runner has come to the drafts, past the time events. */
  let passAtDrafts = false;
  // In the order registrations.ts registers them: time events first, then the drafts.
  registerSender('time', sendOwnTimeEvents);
  registerSender('drafts', () => {
    passAtDrafts = true;
    return sendDrafts();
  });

  beforeEach(async () => {
    setSystemTime(new Date('2026-11-11T12:00:00.000Z')); // The fixtures' day: a week on, they expire.
    await resetDevice();
    await deleteDatabase('werkflow-drafts');
    sent.length = 0;
    passAtDrafts = false;
    uploadsBegun = 0;
    uploadsAborted.length = 0;
  });

  /** Lets queued tasks run until `done` answers true: IndexedDB events and locks only, no clock. */
  async function settles(done: () => boolean): Promise<boolean> {
    for (let turn = 0; turn < 500 && !done(); turn += 1)
      await new Promise((resolve) => setImmediate(resolve));
    return done();
  }

  /** Lets every queued task run: what is left after it is all the device will do without a trigger. */
  async function drained(): Promise<void> {
    await settles(() => false);
  }

  function sentOf(kind: string): string[] {
    return sent.filter((operation) => operation.kind === kind).map((operation) => operation.operationId);
  }

  /**
   * A draft send hangs in a dead spot, the runner's pass waits on it, and a time event is recorded
   * meanwhile, behind it. Then the signal is back: `online` must end the hanging send so the pass after it
   * sends the time event, and the draft goes again.
   */
  async function networkReturnsDuring(hanging: () => boolean): Promise<void> {
    deadSpot = true;
    startDraftSync(WORKER);
    expect(await settles(hanging)).toBe(true);
    const pass = startSyncRunner();
    expect(await settles(() => passAtDrafts)).toBe(true);
    const start = command('start');
    await capture(WORKER, start);

    deadSpot = false;
    for (const listener of onlineListeners) listener();

    expect(await settles(() => sentOf('time.transition').length === 1)).toBe(true);
    await pass;
    expect(sentOf('time.transition')).toEqual([start.operationId]);
    expect(await keptIds(WORKER)).toEqual([]);
  }

  test('a draft attach left hanging never holds back the time events when the network returns', async () => {
    await changeDraftOnDevice(WORKER, draft.id, () => draft);

    await networkReturnsDuring(() => sent.length === 1);

    // The same operation again, unchanged: the server records it once and answers `replayed`.
    await drained();
    expect(sentOf('work_artifact.draft')).toEqual([DRAFT_OPERATION_ID, DRAFT_OPERATION_ID]);
    expect(await listDraftsOnDevice(WORKER)).toEqual([]);
  });

  test('a photo upload left hanging never holds back the time events when the network returns', async () => {
    await changeDraftOnDevice(WORKER, draft.id, () => ({ ...draft, photos: [photo] }));

    await networkReturnsDuring(() => uploadsBegun === 1);

    // The hanging upload ended on the return; the next pass uploaded the photo and attached the draft once.
    await drained();
    expect(uploadsAborted).toEqual([true, false]);
    expect(sentOf('work_artifact.draft')).toEqual([DRAFT_OPERATION_ID]);
    expect(await listDraftsOnDevice(WORKER)).toEqual([]);
  });
}
