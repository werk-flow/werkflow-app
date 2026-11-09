'use client';

import {
  FIELD_SYNC_TODAY_PATH,
  fieldSyncTodaySchema,
  type FieldSyncToday,
} from '@/lib/field-sync/today-snapshot';
import { logError } from '@/lib/logging';
import { readTodayOnDevice, saveTodayOnDevice } from './today-store';
import { TODAY_HOLDER_KEY, clearTodayOnDevice, todayWipeGeneration } from './today-wipe';

// One refresh of the today snapshot on a phone (decision record 0010, "Device
// data"): the device sends the version it holds, an unchanged day costs one
// `304`, a refused person or organization leaves nothing behind. When it runs
// is today-refresh.ts's concern.

/** The signed-in person and active organization the server rendered the page for. */
export type TodayHolder = { userId: string; organizationId: string };

type TodayRefreshOutcome =
  /** A new snapshot is on the device. */
  | 'saved'
  /** The server confirmed the stored snapshot. */
  | 'confirmed'
  /** The server refused the person or organization: nothing stays on the device. */
  | 'cleared'
  /** No signal, a server failure or a session that needs a new sign-in: the device keeps what it has. */
  | 'kept'
  /** A wipe came while this refresh ran, or a newer start page took over: its answer counts for nothing. */
  | 'superseded';

type RefreshOptions = { fetch?: (url: string, init: RequestInit) => Promise<Response>; now?: () => Date };

/**
 * Saves the snapshot unless a wipe, in this tab or another, came after the refresh started. A wipe
 * that lands while the save runs deletes the database again, so the device never keeps a day the
 * person or organization left.
 */
async function saveUnlessWiped(
  snapshot: FieldSyncToday,
  confirmedAt: Date,
  generation: string,
): Promise<boolean> {
  if (todayWipeGeneration() !== generation) return false;
  await saveTodayOnDevice(snapshot, confirmedAt);
  if (todayWipeGeneration() === generation) return true;
  await clearTodayOnDevice();
  return false;
}

function todayHolderKey(holder: TodayHolder): string {
  return `${holder.userId}:${holder.organizationId}`;
}

/** Registers the holder of the latest start page under `TODAY_HOLDER_KEY`, for every tab to see. */
export function claimToday(holder: TodayHolder): void {
  try {
    localStorage.setItem(TODAY_HOLDER_KEY, todayHolderKey(holder));
  } catch {
    // best-effort: without localStorage no other tab can tell this holder is the latest.
  }
}

/**
 * Whether this holder no longer owns the device: a start page in some tab registered another one,
 * or a wipe removed the registration. A sign-out wipes before the session ends, so a refresh that
 * runs on after it must not save a day with the session that is about to end.
 */
function superseded(holder: TodayHolder): boolean {
  try {
    return localStorage.getItem(TODAY_HOLDER_KEY) !== todayHolderKey(holder);
  } catch {
    // best-effort: without localStorage only this tab's start page names the holder.
    return false;
  }
}

function belongsTo(snapshot: { userId: string; organizationId: string }, holder: TodayHolder): boolean {
  return snapshot.userId === holder.userId && snapshot.organizationId === holder.organizationId;
}

/** One refresh of the today snapshot for the holder. Throws only when the device storage fails. */
export async function refreshTodayOnDevice(
  holder: TodayHolder,
  { fetch: send = (url, init) => fetch(url, init), now = () => new Date() }: RefreshOptions = {},
): Promise<TodayRefreshOutcome> {
  // Taken before the first read: a wipe while the device reads makes this refresh stale too.
  let generation = todayWipeGeneration();
  if (superseded(holder)) return 'superseded';
  let stored = await readTodayOnDevice(now());
  if (todayWipeGeneration() !== generation) return 'superseded';
  // Another person's or organization's day never stays beside this one. This holder is the latest
  // start page's, which the server rendered for the session the device has now.
  if (stored && !belongsTo(stored.snapshot, holder)) {
    await clearTodayOnDevice();
    claimToday(holder);
    generation = todayWipeGeneration();
    stored = null;
  }
  let response: Response;
  try {
    response = await send(
      `${FIELD_SYNC_TODAY_PATH}?organizationId=${encodeURIComponent(holder.organizationId)}`,
      {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          // The handler's same-origin guard for a cookie request.
          'content-type': 'application/json',
          ...(stored ? { 'if-none-match': `"${stored.snapshot.version}"` } : {}),
        },
      },
    );
  } catch {
    // best-effort: without signal the stored day is what the phone shows, with its „Stand“.
    return 'kept';
  }
  // Only the refresh that still owns the device acts on the answer; an older one would delete a newer day.
  if (todayWipeGeneration() !== generation || superseded(holder)) return 'superseded';
  if (response.status === 403) {
    await clearTodayOnDevice();
    return 'cleared';
  }
  if (response.status === 304 && stored)
    return (await saveUnlessWiped(stored.snapshot, now(), generation)) ? 'confirmed' : 'superseded';
  if (response.status !== 200) return 'kept';
  const snapshot = fieldSyncTodaySchema.safeParse(await response.json());
  if (!snapshot.success || !belongsTo(snapshot.data, holder)) {
    logError('refreshTodayOnDevice: unexpected snapshot', { readable: snapshot.success });
    return 'kept';
  }
  return (await saveUnlessWiped(snapshot.data, now(), generation)) ? 'saved' : 'superseded';
}
