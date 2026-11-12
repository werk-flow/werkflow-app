import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, test } from 'bun:test';

import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { z } from '@/lib/zod';
import {
  captureTimeEvent,
  clockDeviceView,
  discardTimeEvents,
  isOfflineClockAction,
  retryFirstTimeEvent,
} from './time-outbox';
import { sendTimeOutbox, type TimeOutboxSendOptions } from './time-outbox-send';
import { readTimeOutbox, readWholeTimeOutbox, type OutboxHolder } from './time-outbox-store';
import { TODAY_DATABASE } from './today-wipe';

// The time outbox of werk-flow/werkflow-planning#319 (decision record 0010,
// the 2026-11-11 amendment "the time outbox"): recorded time is money, so an
// event is sent in its order, recorded once, never rewritten, never sent for
// another person and never dropped without the server's answer or the
// person's own decision.

/** localStorage of the origin: the wipe signal the kept clock is stamped with. */
const storage = new Map<string, string>();
globalThis.localStorage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => [...storage.keys()][index] ?? null,
  removeItem: (key) => void storage.delete(key),
  setItem: (key, value) => void storage.set(key, value),
};

/** The database of time-outbox-store.ts, and the 7 days an unsent event counts as waiting (time-outbox.ts). */
const TIME_OUTBOX_DATABASE = 'werkflow-time-outbox';
const UNSENT_TIME_EVENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const WORKER: OutboxHolder = {
  userId: '10000000-0000-4000-8000-00000000000a',
  organizationId: '20000000-0000-4000-8000-00000000000a',
};
const COLLEAGUE: OutboxHolder = { ...WORKER, userId: '10000000-0000-4000-8000-00000000000b' };
const OTHER_COMPANY: OutboxHolder = { ...WORKER, organizationId: '20000000-0000-4000-8000-00000000000b' };
const JOB_ID = '30000000-0000-4000-8000-000000000001';
const SESSION_ID = '40000000-0000-4000-8000-000000000001';

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

const WORKING: LiveClockState = {
  ...CLOCKED_OUT,
  status: 'working',
  isClockedIn: true,
  clockInTime: '2026-11-11T06:00:00.000Z',
  statusStartedAt: '2026-11-11T06:00:00.000Z',
  activeJobId: JOB_ID,
  activeJobInfo: {
    id: JOB_ID,
    title: 'Heizung tauschen',
    jobNumber: 'AUF-1',
    status: 'in_arbeit',
    projectName: 'Neubau Musterweg',
    clientName: 'Erika Beispiel',
  },
  captureModel: 'canonical',
  sessionId: SESSION_ID,
  sessionVersion: 3,
  currentActivity: createActivitySelection('work', JOB_ID),
  resumeActivity: createActivitySelection('work', JOB_ID),
};

type OfflineClockCommand = Omit<Parameters<typeof captureTimeEvent>[1]['command'], 'action'> & {
  action: string;
};

let operations = 0;
/** A clock command as the clock's provider builds it, with a fresh operation id. */
function command(
  action: string,
  overrides: Partial<OfflineClockCommand> = {},
): OfflineClockCommand & { operationId: string } {
  operations += 1;
  return {
    operationId: `50000000-0000-4000-8000-${String(operations).padStart(12, '0')}`,
    action,
    expectedSessionId: null,
    expectedVersion: null,
    selection: action === 'end' ? null : createActivitySelection('work'),
    ...overrides,
  };
}

async function capture(
  holder: OutboxHolder,
  kept: OfflineClockCommand,
  options: { base?: LiveClockState | null; at?: string; triedOnline?: boolean } = {},
) {
  if (!isOfflineClockAction(kept.action)) throw new Error(`${kept.action} cannot be captured without signal`);
  return captureTimeEvent(holder, {
    command: { ...kept, action: kept.action },
    base: options.base === undefined ? CLOCKED_OUT : options.base,
    capturedAt: new Date(options.at ?? '2026-11-11T07:00:00.000Z'),
    triedOnline: options.triedOnline ?? false,
    wipeGeneration: 'signal-1',
  });
}

const sentBodySchema = z.object({
  operations: z.array(
    z.object({
      operationId: z.string(),
      capturedAt: z.string(),
      sentAt: z.string(),
      organizationId: z.string(),
      kind: z.string(),
      payload: z.object({
        action: z.string(),
        expectedSessionId: z.string().nullable(),
        expectedVersion: z.number().nullable(),
      }),
    }),
  ),
});
type SentEnvelope = z.infer<typeof sentBodySchema>['operations'][number];

/** The server's side of the sends: every envelope it got, and the answer it gives to each. */
function server(answer: (envelope: SentEnvelope, call: number) => Response | Error) {
  const received: SentEnvelope[] = [];
  let sends = 0;
  const options: TimeOutboxSendOptions = {
    fetch: async (_url, init) => {
      sends += 1;
      const body = sentBodySchema.parse(JSON.parse(String(init.body)));
      const [envelope] = body.operations;
      if (!envelope || body.operations.length !== 1) throw new Error('one event per request');
      received.push(envelope);
      const response = answer(envelope, received.length);
      if (response instanceof Error) throw response;
      return response;
    },
    now: () => new Date(Date.parse('2026-11-11T09:00:00.000Z') + sends * 1_000),
    sessionIsHolders: async () => true,
  };
  return { received, options };
}

function result(envelope: SentEnvelope, verdict: Record<string, unknown>, status = 200): Response {
  return Response.json({ results: [{ operationId: envelope.operationId, ...verdict }] }, { status });
}

/** Accepts every event and moves the session's version on by one, as the database function does. */
function accepting() {
  let version = 0;
  return server((envelope) => {
    version += 1;
    return result(envelope, {
      outcome: 'accepted',
      code: 'accepted',
      state: { sessionId: SESSION_ID, segmentId: `segment-${version}`, version },
    });
  });
}

/** The envelope as the server hashes it: everything but the time of this send. */
function withoutSentAt(envelope: SentEnvelope): SentEnvelope {
  return { ...envelope, sentAt: '' };
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
  });
}

beforeEach(async () => {
  storage.clear();
  await deleteDatabase(TIME_OUTBOX_DATABASE);
});

describe('sending the chain', () => {
  test('events are sent in the order they were captured, one request each, and the outbox is empty after the answers', async () => {
    const start = command('start');
    const pause = command('switch', { selection: createActivitySelection('break') });
    const end = command('end');
    await capture(WORKER, start, { at: '2026-11-11T07:00:00.000Z' });
    await capture(WORKER, pause, { at: '2026-11-11T11:00:00.000Z' });
    await capture(WORKER, end, { at: '2026-11-11T15:00:00.000Z' });

    const { received, options } = accepting();
    await sendTimeOutbox(WORKER, options);

    expect(received.map((envelope) => envelope.operationId)).toEqual([
      start.operationId,
      pause.operationId,
      end.operationId,
    ]);
    expect(received.map((envelope) => envelope.capturedAt)).toEqual([
      '2026-11-11T07:00:00.000Z',
      '2026-11-11T11:00:00.000Z',
      '2026-11-11T15:00:00.000Z',
    ]);
    expect(received.every((envelope) => envelope.kind === 'time.transition')).toBe(true);
    const after = await readTimeOutbox(WORKER);
    expect(after.events).toEqual([]);
    // The clock keeps what the last answer left, for an action a page kept meanwhile: after an end, no session.
    expect(after.clock?.after).toEqual({ sessionId: null, version: null });
  });

  test('each event names the session and version the answer before it left, and a start after an end names none', async () => {
    await capture(WORKER, command('switch', { expectedSessionId: SESSION_ID, expectedVersion: 3 }), {
      base: WORKING,
    });
    await capture(WORKER, command('end'));
    await capture(WORKER, command('start'));
    let version = 3;
    const { received, options } = server((envelope) => {
      version += 1;
      return result(envelope, {
        outcome: 'accepted',
        code: 'accepted',
        state: { sessionId: SESSION_ID, segmentId: null, version },
      });
    });

    await sendTimeOutbox(WORKER, options);

    expect(received.map((envelope) => envelope.payload)).toEqual([
      expect.objectContaining({ action: 'switch', expectedSessionId: SESSION_ID, expectedVersion: 3 }),
      expect.objectContaining({ action: 'end', expectedSessionId: SESSION_ID, expectedVersion: 4 }),
      expect.objectContaining({ action: 'start', expectedSessionId: null, expectedVersion: null }),
    ]);
  });

  test('a resend carries the same operation id and the same envelope, whatever happened to the sends before it', async () => {
    await capture(WORKER, command('start'));
    const { received, options } = server((envelope, call) => {
      if (call === 1) return new Error('no signal');
      if (call === 2) return result(envelope, { outcome: 'retry', code: 'unavailable' }, 200);
      if (call === 3) return new Response('<html>Hotel-WLAN</html>', { status: 200 });
      return result(envelope, {
        outcome: 'accepted',
        code: 'accepted',
        state: { sessionId: SESSION_ID, segmentId: null, version: 1 },
      });
    });

    for (let pass = 0; pass < 4; pass += 1) await sendTimeOutbox(WORKER, options);

    expect(received).toHaveLength(4);
    const [first] = received;
    expect(first).toBeDefined();
    if (!first) return;
    for (const envelope of received) expect(withoutSentAt(envelope)).toEqual(withoutSentAt(first));
    expect(new Set(received.map((envelope) => envelope.sentAt)).size).toBe(4);
    expect((await readTimeOutbox(WORKER)).events).toEqual([]);
  });

  test('a replayed answer clears the event once, and nothing is sent for it again', async () => {
    const start = command('start');
    await capture(WORKER, start);
    const { received, options } = server((envelope) =>
      result(envelope, {
        outcome: 'replayed',
        code: 'replayed',
        state: { sessionId: SESSION_ID, segmentId: null, version: 1 },
      }),
    );

    await sendTimeOutbox(WORKER, options);
    await sendTimeOutbox(WORKER, options);

    expect(received.map((envelope) => envelope.operationId)).toEqual([start.operationId]);
    expect((await readTimeOutbox(WORKER)).events).toEqual([]);
  });

  test('the server answering for another operation id clears nothing', async () => {
    await capture(WORKER, command('start'));
    const { options } = server(() =>
      Response.json({ results: [{ operationId: 'someone-elses', outcome: 'accepted', code: 'accepted' }] }),
    );

    await sendTimeOutbox(WORKER, options);

    expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
  });
});

describe('an event the server does not record', () => {
  test('a rejected event stays with the server’s code, and nothing behind it is sent', async () => {
    const start = command('start');
    await capture(WORKER, start);
    await capture(WORKER, command('end'));
    const { received, options } = server((envelope) =>
      result(envelope, { outcome: 'rejected', code: 'closed_period' }),
    );

    await sendTimeOutbox(WORKER, options);
    await sendTimeOutbox(WORKER, options);

    expect(received.map((envelope) => envelope.operationId)).toEqual([start.operationId]);
    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'));
    expect(view?.status).toBe('stopped');
    expect(view?.events.map((event) => [event.action, event.status, event.code])).toEqual([
      ['start', 'failed', 'closed_period'],
      ['end', 'held', null],
    ]);
  });

  test('a conflict never overwrites server state: the event is not resent, not rewritten, and the clock shows no state of its own', async () => {
    const end = command('end', { expectedSessionId: SESSION_ID, expectedVersion: 3 });
    await capture(WORKER, end, { base: WORKING });
    const { received, options } = server((envelope) =>
      result(envelope, { outcome: 'conflict', code: 'version_conflict' }, 200),
    );

    await sendTimeOutbox(WORKER, options);
    await sendTimeOutbox(WORKER, options);
    // „Erneut senden“ is for a refusal only: a conflict stays for the person's correction.
    await retryFirstTimeEvent(WORKER);
    await sendTimeOutbox(WORKER, options);

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual(
      expect.objectContaining({ expectedSessionId: SESSION_ID, expectedVersion: 3 }),
    );
    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'));
    expect(view).toEqual(
      expect.objectContaining({
        status: 'stopped',
        state: null,
        events: [expect.objectContaining({ operationId: end.operationId, status: 'conflict' })],
      }),
    );
  });

  test('a late event waits as a correction, and a refused one is sent again unchanged only when the person asks', async () => {
    await capture(WORKER, command('start'));
    let answers: Record<string, unknown> = { outcome: 'conflict', code: 'correction_required' };
    const { received, options } = server((envelope) => result(envelope, answers));
    await sendTimeOutbox(WORKER, options);
    const at = new Date('2026-11-11T09:00:00.000Z');
    expect(clockDeviceView(await readTimeOutbox(WORKER), at)?.events[0]?.status).toBe('correction');

    await discardTimeEvents(WORKER);
    await capture(WORKER, command('start'));
    answers = { outcome: 'rejected', code: 'forbidden' };
    await sendTimeOutbox(WORKER, options);
    await sendTimeOutbox(WORKER, options);
    expect(received).toHaveLength(2);

    answers = { outcome: 'accepted', code: 'accepted' };
    await retryFirstTimeEvent(WORKER);
    await sendTimeOutbox(WORKER, options);

    expect(received).toHaveLength(3);
    const [, refused, resent] = received;
    expect(refused && resent && withoutSentAt(resent)).toEqual(refused && withoutSentAt(refused));
    expect((await readTimeOutbox(WORKER)).events).toEqual([]);
  });

  test('an unknown outcome stops the event as refused, except behind a 5xx status, where it stays pending', async () => {
    await capture(WORKER, command('start'));
    let status = 503;
    const { options } = server((envelope) =>
      result(envelope, { outcome: 'deferred', code: 'later' }, status),
    );
    await sendTimeOutbox(WORKER, options);
    expect((await readTimeOutbox(WORKER)).events[0]?.verdict).toBeNull();

    status = 200;
    await sendTimeOutbox(WORKER, options);
    expect((await readTimeOutbox(WORKER)).events[0]?.verdict).toEqual({ outcome: 'rejected', code: 'later' });
  });

  test('a request refused as a whole is judged by its verdict: a session that needs a new token keeps the event pending', async () => {
    await capture(WORKER, command('start'));
    const { options } = server(() =>
      Response.json({ outcome: 'retry', code: 'unauthenticated' }, { status: 401 }),
    );
    await sendTimeOutbox(WORKER, options);
    expect((await readTimeOutbox(WORKER)).events[0]?.verdict).toBeNull();

    const refused = server(() => Response.json({ outcome: 'rejected', code: 'forbidden' }, { status: 403 }));
    await sendTimeOutbox(WORKER, refused.options);
    expect((await readTimeOutbox(WORKER)).events[0]?.verdict).toEqual({
      outcome: 'rejected',
      code: 'forbidden',
    });
  });

  test('an action whose online call reached the server is never cleared on a guess: the person checks it, and nothing behind it is sent', async () => {
    const start = command('start');
    await capture(WORKER, start, { triedOnline: true });
    await capture(WORKER, command('end'));
    // The server holds the id from the online call. It may hold the start, or only a recovery it answered instead.
    const { received, options } = server((envelope) =>
      result(envelope, { outcome: 'rejected', code: 'idempotency_conflict' }),
    );

    await sendTimeOutbox(WORKER, options);
    await sendTimeOutbox(WORKER, options);

    expect(received.map((envelope) => envelope.payload.action)).toEqual(['start']);
    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'));
    expect(view?.events.map((event) => [event.action, event.status, event.code])).toEqual([
      ['start', 'conflict', 'unconfirmed_online'],
      ['end', 'held', null],
    ]);
  });

  test('an event for an organization that is not the active one waits, and is never refused for good', async () => {
    await capture(WORKER, command('start'));
    let answer: Record<string, unknown> = { outcome: 'rejected', code: 'organization_mismatch' };
    const { received, options } = server((envelope) => result(envelope, answer));

    await sendTimeOutbox(WORKER, options);
    expect((await readTimeOutbox(WORKER)).events[0]?.verdict).toBeNull();

    answer = { outcome: 'accepted', code: 'accepted' };
    await sendTimeOutbox(WORKER, options);
    expect(received).toHaveLength(2);
    expect((await readTimeOutbox(WORKER)).events).toEqual([]);
  });

  test('an action kept behind events the outbox sent meanwhile expects what the last of them left', async () => {
    await capture(WORKER, command('start'), { at: '2026-11-11T07:00:00.000Z' });
    let version = 0;
    const { received, options } = server((envelope) => {
      version += 1;
      return result(envelope, {
        outcome: 'accepted',
        code: 'accepted',
        state: { sessionId: SESSION_ID, segmentId: null, version },
      });
    });
    await sendTimeOutbox(WORKER, options);
    expect((await readTimeOutbox(WORKER)).events).toEqual([]);

    // The page kept the switch while the start was still waiting, with the stale clock it had read.
    await capture(
      WORKER,
      command('switch', {
        expectedSessionId: null,
        expectedVersion: null,
        selection: createActivitySelection('break'),
      }),
      { base: null, at: '2026-11-11T07:30:00.000Z' },
    );
    await sendTimeOutbox(WORKER, options);

    expect(received.map((envelope) => envelope.payload)).toEqual([
      expect.objectContaining({ action: 'start', expectedSessionId: null, expectedVersion: null }),
      expect.objectContaining({ action: 'switch', expectedSessionId: SESSION_ID, expectedVersion: 1 }),
    ]);
  });

  test('an id the server holds for an event that never went online is a refusal, never a success', async () => {
    await capture(WORKER, command('start'));
    const { options } = server((envelope) =>
      result(envelope, { outcome: 'rejected', code: 'idempotency_conflict' }),
    );

    await sendTimeOutbox(WORKER, options);

    expect((await readTimeOutbox(WORKER)).events[0]?.verdict).toEqual({
      outcome: 'rejected',
      code: 'idempotency_conflict',
    });
  });
});

describe('whose events', () => {
  test('nothing is sent while the browser’s session is not the holder’s', async () => {
    await capture(WORKER, command('start'));
    const { received, options } = accepting();

    await sendTimeOutbox(WORKER, { ...options, sessionIsHolders: async () => false });

    expect(received).toEqual([]);
    expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
  });

  test('a session that changes its person between two events stops the chain there', async () => {
    await capture(WORKER, command('start'));
    await capture(WORKER, command('end'));
    const { received, options } = accepting();
    let checks = 0;

    await sendTimeOutbox(WORKER, {
      ...options,
      sessionIsHolders: async () => {
        checks += 1;
        return checks === 1;
      },
    });

    expect(received.map((envelope) => envelope.payload.action)).toEqual(['start']);
    expect((await readTimeOutbox(WORKER)).events.map((event) => event.action)).toEqual(['end']);
  });

  test('a person’s events are never sent, shown or deleted for another person or another organization', async () => {
    const own = command('start');
    await capture(WORKER, own);
    await capture(COLLEAGUE, command('start'));
    await capture(OTHER_COMPANY, command('start'), {
      base: { ...CLOCKED_OUT, organizationId: OTHER_COMPANY.organizationId },
    });

    const { received, options } = accepting();
    await sendTimeOutbox(WORKER, options);
    expect(received.map((envelope) => [envelope.operationId, envelope.organizationId])).toEqual([
      [own.operationId, WORKER.organizationId],
    ]);

    const { deviceHoldsEvents } = await discardTimeEvents(WORKER);
    expect(deviceHoldsEvents).toBe(true);
    expect((await readTimeOutbox(COLLEAGUE)).events).toHaveLength(1);
    expect((await readTimeOutbox(OTHER_COMPANY)).events).toHaveLength(1);
    expect((await readTimeOutbox(COLLEAGUE)).clock?.userId).toBe(COLLEAGUE.userId);
  });

  test('discarding deletes the holder’s events and clock, and says when the device holds none at all', async () => {
    await capture(WORKER, command('start'));
    await capture(WORKER, command('end'));

    expect(await discardTimeEvents(WORKER)).toEqual({
      outbox: { clock: null, events: [] },
      deviceHoldsEvents: false,
    });
    expect(await readWholeTimeOutbox()).toEqual({ clocks: [], events: [] });
  });

  test('the wipe of the stored day leaves the unsent events on the phone', async () => {
    await capture(WORKER, command('start'));
    // What every sign-out does to the device (today-wipe.ts): it names the today database only.
    await deleteDatabase(TODAY_DATABASE);
    expect(TIME_OUTBOX_DATABASE).not.toBe(TODAY_DATABASE);
    expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);
  });
});

describe('capturing', () => {
  test('the first event stands on the confirmed clock and expects its session and version; later ones wait for the answer before them', async () => {
    await capture(WORKER, command('switch', { expectedSessionId: SESSION_ID, expectedVersion: 3 }), {
      base: WORKING,
    });
    await capture(WORKER, command('end'), { base: null });

    const { events } = await readTimeOutbox(WORKER);
    expect(events.map((event) => event.expected)).toEqual([{ sessionId: SESSION_ID, version: 3 }, null]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2]);
  });

  test('only a start, a switch and an end can wait for signal', () => {
    expect(['start', 'switch', 'end'].every(isOfflineClockAction)).toBe(true);
    expect(
      ['continue_legacy', 'end_legacy', 'recover_continue', 'recover_end', ''].some(isOfflineClockAction),
    ).toBe(false);
  });

  test('an action captured behind a chain that waits for the person waits with it, and is never sent ahead of it', async () => {
    await capture(WORKER, command('start'));
    const { received, options } = server((envelope) =>
      result(envelope, { outcome: 'rejected', code: 'forbidden' }),
    );
    await sendTimeOutbox(WORKER, options);

    await capture(WORKER, command('end'));
    await sendTimeOutbox(WORKER, options);

    expect(received).toHaveLength(1);
    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'));
    expect(view?.events.map((event) => [event.action, event.status])).toEqual([
      ['start', 'failed'],
      ['end', 'held'],
    ]);
  });

  test('a first action without a confirmed clock is still kept and sent; only the clock shows no state of its own', async () => {
    await capture(WORKER, command('start'), { base: null });

    const outbox = await readTimeOutbox(WORKER);
    expect(outbox.clock).toBeNull();
    expect(clockDeviceView(outbox, new Date('2026-11-11T09:00:00.000Z'))).toEqual(
      expect.objectContaining({ status: 'pending', state: null }),
    );
    const { received, options } = accepting();
    await sendTimeOutbox(WORKER, options);
    expect(received).toHaveLength(1);
  });

  test('the same action captured twice is kept once', async () => {
    const start = command('start');
    await capture(WORKER, start);
    await capture(WORKER, command('end'));
    await capture(WORKER, start);

    expect((await readTimeOutbox(WORKER)).events.map((event) => event.action)).toEqual(['start', 'end']);
  });

  test('the kept clock holds no job, customer or project name, and the wipe signal it was captured under', async () => {
    await capture(WORKER, command('end', { expectedSessionId: SESSION_ID, expectedVersion: 3 }), {
      base: WORKING,
    });

    const { clock } = await readTimeOutbox(WORKER);
    expect(clock?.base?.activeJobInfo).toBeNull();
    expect(clock?.base?.resumeJobInfo).toBeNull();
    expect(clock?.wipeGeneration).toBe('signal-1');
    const kept = JSON.stringify(await readWholeTimeOutbox());
    expect(kept).not.toContain('Heizung tauschen');
    expect(kept).not.toContain('Erika Beispiel');
  });
});

describe('what the clock shows', () => {
  test('the unsent events are applied at their captured times', async () => {
    await capture(WORKER, command('start'), { at: '2026-11-11T07:00:00.000Z' });
    await capture(WORKER, command('switch', { selection: createActivitySelection('break') }), {
      at: '2026-11-11T11:00:00.000Z',
    });

    const view = clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T11:10:00.000Z'));

    expect(view?.status).toBe('pending');
    expect(view?.events.map((event) => event.status)).toEqual(['pending', 'pending']);
    expect(view?.state).toEqual(
      expect.objectContaining({
        status: 'on_break',
        isClockedIn: true,
        clockInTime: '2026-11-11T07:00:00.000Z',
        statusStartedAt: '2026-11-11T11:00:00.000Z',
        workMinutes: 240,
      }),
    );
  });

  test('after an accepted event the clock stands where it stood: the event moves from the queue into the confirmed clock', async () => {
    await capture(WORKER, command('start'), { at: '2026-11-11T07:00:00.000Z' });
    await capture(WORKER, command('end'), { at: '2026-11-11T15:00:00.000Z' });
    const at = new Date('2026-11-11T15:10:00.000Z');
    const before = clockDeviceView(await readTimeOutbox(WORKER), at)?.state;
    const { options } = server((envelope, call) =>
      call === 1
        ? result(envelope, {
            outcome: 'accepted',
            code: 'accepted',
            state: { sessionId: SESSION_ID, segmentId: null, version: 1 },
          })
        : new Error('signal lost again'),
    );

    await sendTimeOutbox(WORKER, options);

    const after = clockDeviceView(await readTimeOutbox(WORKER), at);
    expect(after?.events.map((event) => event.action)).toEqual(['end']);
    expect(after?.state).toEqual(
      expect.objectContaining({ status: before?.status, workMinutes: before?.workMinutes }),
    );
    expect(after?.state?.status).toBe('clocked_out');
    expect(after?.state?.workMinutes).toBe(480);
  });

  test('an event that waited longer than the device keeps trying shows as not transferred, and is still the server’s to judge', async () => {
    await capture(WORKER, command('start'), { at: '2026-11-01T07:00:00.000Z' });
    const captured = Date.parse('2026-11-01T07:00:00.000Z');

    const within = clockDeviceView(
      await readTimeOutbox(WORKER),
      new Date(captured + UNSENT_TIME_EVENT_KEEP_MS),
    );
    const beyond = clockDeviceView(
      await readTimeOutbox(WORKER),
      new Date(captured + UNSENT_TIME_EVENT_KEEP_MS + 1),
    );

    expect(within?.events[0]).toEqual(expect.objectContaining({ status: 'pending', code: null }));
    expect(beyond).toEqual(
      expect.objectContaining({
        status: 'stopped',
        state: null,
        events: [expect.objectContaining({ status: 'failed', code: 'expired' })],
      }),
    );
    expect((await readTimeOutbox(WORKER)).events).toHaveLength(1);

    const { received, options } = server((envelope) =>
      result(envelope, { outcome: 'rejected', code: 'outside_recording_window' }),
    );
    await sendTimeOutbox(WORKER, options);
    expect(received).toHaveLength(1);
    expect((await readTimeOutbox(WORKER)).events[0]?.verdict?.code).toBe('outside_recording_window');
  });

  test('an outbox without events shows nothing', async () => {
    expect(clockDeviceView(await readTimeOutbox(WORKER), new Date('2026-11-11T09:00:00.000Z'))).toBeNull();
  });
});
