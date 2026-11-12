import 'fake-indexeddb/auto';

import { createActivitySelection } from '@/lib/time-tracking/segments';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { z } from '@/lib/zod';
import { captureTimeEvent, isOfflineClockAction } from '@/lib/field-sync/device/time-outbox';
import type { TimeOutboxSendOptions } from '@/lib/field-sync/device/time-outbox-send';
import { readTimeOutbox, type OutboxHolder } from '@/lib/field-sync/device/time-outbox-store';

// What the time outbox's unit tests share (lib/field-sync/device/time-outbox*.test.ts): the
// browser's storage, the people and clocks, the commands as the provider builds them, and a
// server that answers each send.

/** localStorage of the origin: the wipe signal the kept clock is stamped with. */
export const storage = new Map<string, string>();
const deviceStorage: Storage = {
  get length() {
    return storage.size;
  },
  clear: () => storage.clear(),
  getItem: (key) => storage.get(key) ?? null,
  key: (index) => [...storage.keys()][index] ?? null,
  removeItem: (key) => void storage.delete(key),
  setItem: (key, value) => void storage.set(key, value),
};
globalThis.localStorage = deviceStorage;

/** The database of time-outbox-store.ts, and the 7 days an unsent event counts as waiting (time-outbox.ts). */
export const TIME_OUTBOX_DATABASE = 'werkflow-time-outbox';
export const UNSENT_TIME_EVENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export const WORKER: OutboxHolder = {
  userId: '10000000-0000-4000-8000-00000000000a',
  organizationId: '20000000-0000-4000-8000-00000000000a',
};
export const COLLEAGUE: OutboxHolder = { ...WORKER, userId: '10000000-0000-4000-8000-00000000000b' };
export const OTHER_COMPANY: OutboxHolder = {
  ...WORKER,
  organizationId: '20000000-0000-4000-8000-00000000000b',
};
export const JOB_ID = '30000000-0000-4000-8000-000000000001';
export const SESSION_ID = '40000000-0000-4000-8000-000000000001';
export const OTHER_SESSION_ID = '40000000-0000-4000-8000-000000000002';

export const CLOCKED_OUT: LiveClockState = {
  organizationId: WORKER.organizationId,
  breakPolicy: { breakMode: 'manual', autoBreakThresholdMinutes: 360, autoBreakDurationMinutes: 30 },
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

export const WORKING: LiveClockState = {
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

export type OfflineClockCommand = Omit<Parameters<typeof captureTimeEvent>[1]['command'], 'action'> & {
  action: string;
};

/** The operation ids the holder's outbox holds, as the person is shown them. */
export async function keptIds(holder: OutboxHolder): Promise<string[]> {
  return (await readTimeOutbox(holder)).events.map((event) => event.operationId);
}

let operations = 0;
/** A clock command as the clock's provider builds it, with a fresh operation id. */
export function command(
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

export async function capture(
  holder: OutboxHolder,
  kept: OfflineClockCommand,
  options: {
    base?: LiveClockState | null;
    at?: string;
    triedOnline?: boolean;
    readAt?: string | null;
  } = {},
) {
  if (!isOfflineClockAction(kept.action)) throw new Error(`${kept.action} cannot be captured without signal`);
  return captureTimeEvent(holder, {
    command: { ...kept, action: kept.action },
    base: options.base === undefined ? CLOCKED_OUT : options.base,
    capturedAt: new Date(options.at ?? '2026-11-11T07:00:00.000Z'),
    triedOnline: options.triedOnline ?? false,
    readAt: options.readAt ? new Date(options.readAt) : null,
    wipeGeneration: 'signal-1',
  });
}

export const sentBodySchema = z.object({
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
export type SentEnvelope = z.infer<typeof sentBodySchema>['operations'][number];

/** The server's side of the sends: every envelope it got, and the answer it gives to each. */
export function server(answer: (envelope: SentEnvelope, call: number) => Response | Error) {
  const received: SentEnvelope[] = [];
  /** The bearer token of each request: the identity the server records the event for. */
  const tokens: string[] = [];
  let sends = 0;
  const options: TimeOutboxSendOptions = {
    fetch: async (_url, init) => {
      sends += 1;
      const body = sentBodySchema.parse(JSON.parse(String(init.body)));
      const [envelope] = body.operations;
      if (!envelope || body.operations.length !== 1) throw new Error('one event per request');
      received.push(envelope);
      tokens.push(new Headers(init.headers).get('authorization') ?? '');
      const response = answer(envelope, received.length);
      if (response instanceof Error) throw response;
      return response;
    },
    now: () => new Date(Date.parse('2026-11-11T09:00:00.000Z') + sends * 1_000),
    holdersToken: async () => 'token-of-the-holder',
  };
  return { received, tokens, options };
}

export function result(envelope: SentEnvelope, verdict: Record<string, unknown>, status = 200): Response {
  return Response.json({ results: [{ operationId: envelope.operationId, ...verdict }] }, { status });
}

/** Accepts every event and moves the session's version on by one, as the database function does. */
export function accepting() {
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
export function withoutSentAt(envelope: SentEnvelope): SentEnvelope {
  return { ...envelope, sentAt: '' };
}

export async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
  });
}

/** A device without unsent work: run before each test. */
export async function resetDevice(): Promise<void> {
  // Another test file of the same run may have put its own localStorage in place.
  globalThis.localStorage = deviceStorage;
  storage.clear();
  await deleteDatabase(TIME_OUTBOX_DATABASE);
}

/** Web Locks within this one tab: each lock name runs its holders one after the other, and `ifAvailable` sees a held one. */
export function installTabLocks(): void {
  const held = new Map<string, Promise<unknown>>();
  const holding = new Map<string, number>();
  type LockWork = (lock: object | null) => Promise<unknown> | unknown;
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: (name: string, options: { ifAvailable?: boolean } | LockWork, given?: LockWork) => {
        const work = typeof options === 'function' ? options : given;
        if (!work) throw new Error('a lock request needs its work');
        if (typeof options !== 'function' && options.ifAvailable && (holding.get(name) ?? 0) > 0)
          return Promise.resolve(work(null));
        const hold = async (): Promise<unknown> => {
          holding.set(name, (holding.get(name) ?? 0) + 1);
          try {
            return await work({});
          } finally {
            holding.set(name, (holding.get(name) ?? 1) - 1);
          }
        };
        const run = (held.get(name) ?? Promise.resolve()).then(hold, hold);
        // The next holder waits for this one either way; the failure reaches the caller through `run`.
        const settled = run.then(
          () => undefined,
          () => undefined,
        );
        held.set(name, settled);
        return run;
      },
    },
  });
}
