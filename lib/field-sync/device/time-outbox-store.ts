'use client';

import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import { clockStateSchema } from '@/lib/time-tracking/state-client';
import { z } from '@/lib/zod';
import { todayHolderKey } from './today-store';

// The web half of the time outbox on a phone (decision record 0010, "Device
// data"): the clock events a person captured without signal, in their order,
// and the clock they stand on. It is the person's work, not a cache, so it
// sits in a database of its own that no wipe deletes: an event leaves only
// with the server's answer or the person's own decision. Every change is one
// transaction over both stores. A native client replaces this module and
// keeps the rules of time-outbox.ts.

/** The IndexedDB database of unsent time events. The static wipe (today-wipe.ts) never names it. */
export const TIME_OUTBOX_DATABASE = 'werkflow-time-outbox';

const EVENTS = 'events';
const CLOCKS = 'clocks';

/** Whose events these are. The server never sees it: only this device keeps one person's events from another's session. */
export type OutboxHolder = { userId: string; organizationId: string };

const expectationSchema = z.object({ sessionId: z.string().nullable(), version: z.number().nullable() });

const storedTimeEventSchema = z.object({
  /** The idempotency key, created once when the person acted. It never changes on a resend. */
  operationId: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  /** The position in the person's queue; events are sent in this order, one after the other. */
  sequence: z.number(),
  capturedAt: z.string(),
  action: z.enum(['start', 'switch', 'end']),
  selection: timeActivitySelectionSchema.nullable(),
  /**
   * The session and version this event expects on the server, fixed before its first send. Null
   * while the event before it has no answer yet: that answer names them.
   */
  expected: expectationSchema.nullable(),
  /** The first send was the online clock call, under this same operation id. */
  triedOnline: z.boolean(),
  /** The server's permanent answer, while the event waits for the person's decision. */
  verdict: z.object({ outcome: z.enum(['rejected', 'conflict']), code: z.string() }).nullable(),
});

export type StoredTimeEvent = z.infer<typeof storedTimeEventSchema>;

const storedClockSchema = z.object({
  /** `userId:organizationId`, the record's key. */
  holder: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  /** The clock as the server last confirmed it, which the unsent events are applied to. */
  base: clockStateSchema,
  /** The wipe signal when the clock was last saved in the person's own session (today-store.ts). */
  wipeGeneration: z.string(),
});

export type StoredClock = z.infer<typeof storedClockSchema>;

/** One person's unsent time events in an organization, in the order they are sent, and their clock. */
export type TimeOutbox = { clock: StoredClock | null; events: StoredTimeEvent[] };

type OutboxContents = { clocks: StoredClock[]; events: StoredTimeEvent[] };

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TIME_OUTBOX_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(EVENTS, { keyPath: 'operationId' });
      request.result.createObjectStore(CLOCKS, { keyPath: 'holder' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('The time outbox did not open'));
  });
}

/**
 * Everything the outbox holds, read inside `transaction`, then handed to `handle` while the
 * transaction is still active, so `handle` may queue its writes in it. A record this version cannot
 * read aborts the transaction: an unsent time event is never skipped or deleted unread.
 */
function withContents(transaction: IDBTransaction, handle: (contents: OutboxContents) => void): void {
  const events = transaction.objectStore(EVENTS).getAll();
  const clocks = transaction.objectStore(CLOCKS).getAll();
  clocks.onsuccess = () => {
    const parsed = z
      .object({ events: z.array(storedTimeEventSchema), clocks: z.array(storedClockSchema) })
      .safeParse({ events: events.result, clocks: clocks.result });
    if (!parsed.success) {
      transaction.abort();
      return;
    }
    handle({
      clocks: parsed.data.clocks,
      events: parsed.data.events.toSorted((left, right) => left.sequence - right.sequence),
    });
  };
}

/** Runs one transaction over both stores and closes the connection. Rejects when it aborts or the store fails. */
async function transact<Result>(
  mode: IDBTransactionMode,
  run: (contents: OutboxContents, transaction: IDBTransaction) => Result,
): Promise<Result> {
  const database = await openOutbox();
  try {
    return await new Promise<Result>((resolve, reject) => {
      const transaction = database.transaction([EVENTS, CLOCKS], mode);
      let result: { value: Result } | null = null;
      transaction.oncomplete = () => {
        if (result) resolve(result.value);
        else reject(new Error('The time outbox answered nothing'));
      };
      transaction.onabort = () => reject(transaction.error ?? new Error('The time outbox could not be read'));
      withContents(transaction, (contents) => {
        result = { value: run(contents, transaction) };
      });
    });
  } finally {
    database.close();
  }
}

function outboxOf(contents: OutboxContents, holder: OutboxHolder): TimeOutbox {
  return {
    clock: contents.clocks.find((clock) => clock.holder === todayHolderKey(holder)) ?? null,
    events: contents.events.filter(
      (event) => event.userId === holder.userId && event.organizationId === holder.organizationId,
    ),
  };
}

/** The holder's unsent events and clock. Throws when the device storage fails or holds an unreadable record. */
export function readTimeOutbox(holder: OutboxHolder): Promise<TimeOutbox> {
  return transact('readonly', (contents) => outboxOf(contents, holder));
}

/**
 * Changes the holder's outbox in one transaction: `change` gets what the device holds now and
 * answers what it holds next, or null to leave it. Events and the clock change together or not at
 * all, and another tab's change is never overwritten by a stale read. Answers the outbox after the
 * change and whether any person's event is left on the device.
 */
export function changeTimeOutbox(
  holder: OutboxHolder,
  change: (current: TimeOutbox) => TimeOutbox | null,
): Promise<{ outbox: TimeOutbox; deviceHoldsEvents: boolean }> {
  return transact('readwrite', (contents, transaction) => {
    const current = outboxOf(contents, holder);
    const next = change(current) ?? current;
    const events = transaction.objectStore(EVENTS);
    const kept = new Set(next.events.map((event) => event.operationId));
    for (const event of current.events) if (!kept.has(event.operationId)) events.delete(event.operationId);
    for (const event of next.events) if (!current.events.includes(event)) events.put(event);
    const clocks = transaction.objectStore(CLOCKS);
    if (next.clock && next.clock !== current.clock) clocks.put(next.clock);
    if (!next.clock && current.clock) clocks.delete(current.clock.holder);
    const others = contents.events.length - current.events.length;
    return { outbox: next, deviceHoldsEvents: others + next.events.length > 0 };
  });
}

/** Every person's events and clocks on the device: for a reader that knows no session, such as the offline page. */
export function readWholeTimeOutbox(): Promise<{ clocks: StoredClock[]; events: StoredTimeEvent[] }> {
  return transact('readonly', (contents) => contents);
}
