'use client';

import { fieldSyncTodaySchema, type FieldSyncToday } from '@/lib/field-sync/today-snapshot';
import { z } from '@/lib/zod';
import { requestResult, runInStore } from './device-store';
import { TODAY_DATABASE, TODAY_HOLDER_KEY, TODAY_WIPE_KEY } from './today-wipe';

// The web half of the today snapshot on a phone (decision record 0010,
// "Device data"): one IndexedDB record with the latest snapshot of the
// signed-in person and organization, and when the server last confirmed it.
// It holds the current Berlin day only: once the day the server named has
// ended, a wipe came after it was saved, or the device is no longer claimed
// for its person and organization, the record is deleted the first time anything reads it. A native client replaces this module and
// keeps the same rules.

const STORE = 'today';
const CURRENT = 'current';
const PERSISTENCE = 'persistence';

const storedTodaySchema = z.strictObject({
  snapshot: fieldSyncTodaySchema,
  /** When the server last confirmed the snapshot: the „Stand“ the device shows. */
  confirmedAt: z.iso.datetime({ offset: true }),
  /** The wipe signal when the day was saved: after a later wipe it is refused, even if its delete failed. */
  wipeGeneration: z.string(),
});

export type StoredToday = z.infer<typeof storedTodaySchema>;

const persistenceSchema = z.strictObject({ granted: z.boolean(), askedAt: z.iso.datetime({ offset: true }) });

function openDatabase(): Promise<IDBDatabase> {
  const request = indexedDB.open(TODAY_DATABASE, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE);
  };
  return requestResult(request).then((database) => {
    // A wipe from this or another tab deletes the database: let it, at once.
    database.onversionchange = () => database.close();
    return database;
  });
}

/** Runs one request in its own transaction and closes the connection, so a wipe is never blocked. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await runInStore(database, STORE, mode, run);
  } finally {
    database.close();
  }
}

/**
 * The stored snapshot of the current Berlin day, or null. A record whose day
 * has ended, one saved before the latest wipe, or one this version cannot
 * read, is deleted before null returns.
 * Throws when IndexedDB itself fails: the caller shows that, never an empty day.
 */
export async function readTodayOnDevice(now: Date = new Date()): Promise<StoredToday | null> {
  const value: unknown = await withStore('readwrite', (store) => {
    const request = store.get(CURRENT);
    // Checked and deleted in the read's own transaction: a new day another tab saves meanwhile is
    // never the record deleted. Only the record goes: an ended day is no sign-out, so no refresh or
    // other tab needs to start over.
    request.addEventListener('success', () => {
      if (request.result !== undefined && !currentDay(request.result, now)) store.delete(CURRENT);
    });
    return request;
  });
  return currentDay(value, now);
}

/**
 * The latest wipe signal any tab of the origin gave (today-wipe.ts), or null when localStorage
 * cannot be read: then no stored day can be shown to be from after the latest wipe.
 */
export function sharedWipeGeneration(): string | null {
  try {
    return localStorage.getItem(TODAY_WIPE_KEY) ?? '';
  } catch {
    // Fails closed: the reader shows no stored day, and the page stays „Gerade kein Netz“.
    return null;
  }
}

/** The `TODAY_HOLDER_KEY` value of a person and organization. */
export function todayHolderKey(holder: { userId: string; organizationId: string }): string {
  return `${holder.userId}:${holder.organizationId}`;
}

/**
 * Who the latest start page claimed the device for (`userId:organizationId`, the claim without its
 * tab token), or null after a wipe, without localStorage, or for a claim without a token.
 */
function deviceHolder(): string | null {
  try {
    const claim = localStorage.getItem(TODAY_HOLDER_KEY)?.split(':');
    return claim?.length === 3 ? `${claim[0]}:${claim[1]}` : null;
  } catch {
    // Fails closed, as for the wipe signal.
    return null;
  }
}

/**
 * The stored day if it may still show: of the current Berlin day, saved under the latest wipe
 * signal, and of the person and organization the device is claimed for. A wipe removes the claim
 * before it writes the signal, so a wipe whose signal and delete both fail still hides the day.
 */
function currentDay(value: unknown, now: Date): StoredToday | null {
  const stored = storedTodaySchema.safeParse(value);
  return stored.success &&
    stored.data.wipeGeneration === sharedWipeGeneration() &&
    todayHolderKey(stored.data.snapshot) === deviceHolder() &&
    now.getTime() < Date.parse(stored.data.snapshot.validUntil)
    ? stored.data
    : null;
}

/**
 * Replaces whatever the device held with this snapshot. With `stillCurrent`, the write happens
 * only if it holds when the write's transaction is queued: the browser runs the transactions of
 * the store in that order, so a wipe or a newer day queued earlier always comes first, and a stale
 * answer never overwrites them. Returns whether it wrote. A full disk rejects (`QuotaExceededError`).
 */
export async function saveTodayOnDevice(
  snapshot: FieldSyncToday,
  confirmedAt: Date,
  stillCurrent: () => boolean = () => true,
): Promise<boolean> {
  let written = false;
  await withStore('readwrite', (store) => {
    // Read before the check: a wipe signalled after it never stamps an answer from before it.
    const signal = sharedWipeGeneration();
    written = stillCurrent();
    const entry: StoredToday = {
      snapshot,
      confirmedAt: confirmedAt.toISOString(),
      // A day saved without a readable signal is never shown: no reader can match it.
      wipeGeneration: signal ?? 'unreadable',
    };
    // A skipped write still needs one request for the transaction to settle on.
    return written ? store.put(entry, CURRENT) : store.get(CURRENT);
  });
  return written;
}

/**
 * Deletes the stored day if it belongs to someone else, checked in the delete's own transaction:
 * a day saved meanwhile for the holder stays. No wipe is signalled, so a sign-out that wipes
 * meanwhile still ends the refresh that called this.
 */
export async function dropOthersTodayOnDevice(isOwn: (snapshot: FieldSyncToday) => boolean): Promise<void> {
  await withStore('readwrite', (store) => {
    const request = store.get(CURRENT);
    request.addEventListener('success', () => {
      const stored = storedTodaySchema.safeParse(request.result);
      if (stored.success && !isOwn(stored.data.snapshot)) store.delete(CURRENT);
    });
    return request;
  });
}

/** Whether the browser already granted persistent storage when this device last asked. */
export async function readPersistenceOnDevice(): Promise<boolean> {
  const value: unknown = await withStore('readonly', (store) => store.get(PERSISTENCE));
  const persistence = persistenceSchema.safeParse(value);
  return persistence.success && persistence.data.granted;
}

/** Records the browser's answer to `navigator.storage.persist()`; a refusal is a normal state. */
export async function savePersistenceOnDevice(granted: boolean, askedAt: Date): Promise<void> {
  await withStore('readwrite', (store) =>
    store.put({ granted, askedAt: askedAt.toISOString() }, PERSISTENCE),
  );
}
