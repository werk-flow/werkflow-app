import { beforeEach, expect, test } from 'bun:test';

import {
  SESSION_ID,
  TIME_OUTBOX_DATABASE,
  WORKER,
  WORKING,
  resetDevice,
  storage,
} from '@/lib/testing/fixtures/time-outbox';
import { takeInKeptClockActions } from './kept-clock-actions';
import { readTimeOutbox, type TimeOutbox } from './time-outbox-store';

// The stored formats of the time outbox (decision record 0010, the time outbox's invariant 8): a
// record an earlier version wrote is always readable, because a time event can wait on a phone
// across releases. Each golden record below is the exact JSON a version 1 client writes; the
// current readers must read it to the same meaning.

const PINNED =
  'A version 1 record no longer reads to the same meaning. Never edit a golden record: raise STORED_RECORD_VERSION (stored-clock-facts.ts) and add a reader that upgrades version 1 records (stored-clock.ts).';

const KEPT_KEY = 'werkflow:unsent:clock:001794384000000:1:50000000-0000-4000-8000-0000000000f1';

const GOLDEN_STORED_CLOCK =
  '{"organizationId":"20000000-0000-4000-8000-00000000000a","breakPolicy":{"breakMode":"manual","autoBreakThresholdMinutes":360,"autoBreakDurationMinutes":30},"status":"working","isClockedIn":true,"isOnBreak":false,"clockInTime":"2026-11-11T06:00:00.000Z","statusStartedAt":"2026-11-11T06:00:00.000Z","breakStartTime":null,"todayMinutes":0,"workMinutes":0,"breakMinutes":0,"standbyMinutes":0,"travelMinutes":0,"calloutMinutes":0,"internalMinutes":0,"timelineSegments":[],"activeJobId":"30000000-0000-4000-8000-000000000001","captureModel":"canonical","sessionId":"40000000-0000-4000-8000-000000000001","sessionVersion":3,"currentSegmentId":null,"currentActivity":{"kind":"work","allocationKind":"job","jobId":"30000000-0000-4000-8000-000000000001"},"resumeActivity":{"kind":"work","allocationKind":"job","jobId":"30000000-0000-4000-8000-000000000001"},"recoveryReason":null,"legacyOpen":false,"fetchedAt":"2026-11-11T06:00:00.000Z"}';

/** A clock action a page kept without signal (unsent-mark.ts), in localStorage. */
const GOLDEN_KEPT_ACTION = `{"userId":"10000000-0000-4000-8000-00000000000a","organizationId":"20000000-0000-4000-8000-00000000000a","operationId":"50000000-0000-4000-8000-0000000000f1","action":"switch","expectedSessionId":"40000000-0000-4000-8000-000000000001","expectedVersion":3,"selection":{"kind":"break","allocationKind":"none"},"base":${GOLDEN_STORED_CLOCK},"readAt":"2026-11-11T07:59:00.000Z","capturedAt":"2026-11-11T08:00:00.000Z","triedOnline":true,"version":1,"wipeGeneration":""}`;

/** An unsent event in the outbox's `events` store (time-outbox-store.ts). */
const GOLDEN_OUTBOX_EVENT =
  '{"version":1,"operationId":"50000000-0000-4000-8000-0000000000f1","userId":"10000000-0000-4000-8000-00000000000a","organizationId":"20000000-0000-4000-8000-00000000000a","sequence":1,"capturedAt":"2026-11-11T08:00:00.000Z","action":"switch","selection":{"kind":"break","allocationKind":"none"},"expected":{"sessionId":"40000000-0000-4000-8000-000000000001","version":3},"triedOnline":true,"verdict":null}';

/** The clock an outbox stands on, in its `clocks` store. */
const GOLDEN_OUTBOX_CLOCK = `{"version":1,"holder":"10000000-0000-4000-8000-00000000000a:20000000-0000-4000-8000-00000000000a","userId":"10000000-0000-4000-8000-00000000000a","organizationId":"20000000-0000-4000-8000-00000000000a","base":${GOLDEN_STORED_CLOCK},"wipeGeneration":""}`;

/** What all three records mean: one switch to a break, standing on the confirmed working clock. */
const MEANING: TimeOutbox = {
  clock: {
    version: 1,
    holder: `${WORKER.userId}:${WORKER.organizationId}`,
    ...WORKER,
    base: { ...WORKING, activeJobInfo: null, resumeJobInfo: null },
    wipeGeneration: '',
  },
  events: [
    {
      version: 1,
      operationId: '50000000-0000-4000-8000-0000000000f1',
      ...WORKER,
      sequence: 1,
      capturedAt: '2026-11-11T08:00:00.000Z',
      action: 'switch',
      selection: { kind: 'break', allocationKind: 'none' },
      expected: { sessionId: SESSION_ID, version: 3 },
      triedOnline: true,
      verdict: null,
    },
  ],
};

beforeEach(resetDevice);

function expectMeaning(read: TimeOutbox): void {
  try {
    expect(read).toEqual(MEANING);
  } catch (difference) {
    throw new Error(`${PINNED}\n${difference instanceof Error ? difference.message : String(difference)}`);
  }
}

/** Puts raw records into the outbox's stores, as an earlier version left them. */
async function putOutboxRecords(event: string, clock: string): Promise<void> {
  await readTimeOutbox(WORKER);
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TIME_OUTBOX_DATABASE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(['events', 'clocks'], 'readwrite');
    transaction.objectStore('events').put(JSON.parse(event));
    transaction.objectStore('clocks').put(JSON.parse(clock));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

/** The record with one field a later version added. */
function withAddedField(record: string): string {
  return `${record.slice(0, -1)},"addedLater":{"any":"value"}}`;
}

test('a version 1 kept clock action reads to the same meaning', async () => {
  storage.set(KEPT_KEY, GOLDEN_KEPT_ACTION);
  await takeInKeptClockActions(() => true);
  expectMeaning(await readTimeOutbox(WORKER));
});

test('a version 1 outbox event and clock read to the same meaning', async () => {
  await putOutboxRecords(GOLDEN_OUTBOX_EVENT, GOLDEN_OUTBOX_CLOCK);
  expectMeaning(await readTimeOutbox(WORKER));
});

test('a field a later version added is ignored, never a reason to stop', async () => {
  storage.set(KEPT_KEY, withAddedField(GOLDEN_KEPT_ACTION));
  await takeInKeptClockActions(() => true);
  expectMeaning(await readTimeOutbox(WORKER));

  await resetDevice();
  await putOutboxRecords(withAddedField(GOLDEN_OUTBOX_EVENT), withAddedField(GOLDEN_OUTBOX_CLOCK));
  expectMeaning(await readTimeOutbox(WORKER));
});

test('a record of a version this code does not know is a stop, never read as something else', async () => {
  storage.set(KEPT_KEY, GOLDEN_KEPT_ACTION.replace('"version":1', '"version":2'));
  expect(await takeInKeptClockActions(() => true)).toEqual(
    expect.objectContaining({ moved: 0, unreadable: 1, stopAt: Date.parse('2026-11-11T08:00:00.000Z') }),
  );

  await putOutboxRecords(GOLDEN_OUTBOX_EVENT.replace('"version":1', '"version":2'), GOLDEN_OUTBOX_CLOCK);
  await expect(readTimeOutbox(WORKER)).rejects.toThrow();
});
