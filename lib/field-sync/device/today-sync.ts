'use client';

import { z } from 'zod';

import {
  FIELD_SYNC_TODAY_PATH,
  fieldSyncTodaySchema,
  type FieldSyncToday,
} from '@/lib/field-sync/today-snapshot';
import { logError } from '@/lib/logging';
import { dropOthersTodayOnDevice, readTodayOnDevice, saveTodayOnDevice, todayHolderKey } from './today-store';
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
 * Saves the snapshot unless a wipe, in this tab or another, or a newer start page came after the
 * refresh started. The check runs where the write is queued, so a stale answer never overwrites a
 * newer day, and a wipe queued after the write deletes it.
 */
function saveUnlessWiped(
  snapshot: FieldSyncToday,
  confirmedAt: Date,
  owner: { holder: TodayHolder; generation: string },
): Promise<boolean> {
  return saveTodayOnDevice(
    snapshot,
    confirmedAt,
    () => todayWipeGeneration() === owner.generation && !superseded(owner.holder),
  );
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

const refusalSchema = z.object({ outcome: z.string(), code: z.string() });

/**
 * Whether a refusal says the person lost access to the organization's day (decision record 0010,
 * "the today snapshot"): only then must the stored customer data go. The answer's outcome decides,
 * never its status. A `retry`, a `rejected` `invalid` (a fault of this client, not an access
 * change) and a body that is not a refusal keep the day.
 */
async function losesAccess(response: Response): Promise<boolean> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // best-effort: a proxy's or a cut-off page says nothing about access; the stored day stays.
    return false;
  }
  const refusal = refusalSchema.safeParse(body);
  return (
    refusal.success &&
    refusal.data.outcome === 'rejected' &&
    (refusal.data.code === 'forbidden' || refusal.data.code === 'organization_mismatch')
  );
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
  const generation = todayWipeGeneration();
  if (superseded(holder)) return 'superseded';
  let stored = await readTodayOnDevice(now());
  if (todayWipeGeneration() !== generation) return 'superseded';
  // Another person's or organization's day never stays beside this one. This holder is the latest
  // start page's, which the server rendered for the session the device has now. Only that record
  // goes, and the generation stays: a sign-out that wipes meanwhile still ends this refresh.
  if (stored && !belongsTo(stored.snapshot, holder)) {
    await dropOthersTodayOnDevice((snapshot) => belongsTo(snapshot, holder));
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
  if (response.status === 304 && stored)
    return (await saveUnlessWiped(stored.snapshot, now(), { holder, generation }))
      ? 'confirmed'
      : 'superseded';
  if (response.status !== 200) {
    if (!(await losesAccess(response))) return 'kept';
    await clearTodayOnDevice();
    return 'cleared';
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // best-effort: a captive portal's page or a body cut off by lost signal is no day; the stored one stays.
    return 'kept';
  }
  const snapshot = fieldSyncTodaySchema.safeParse(body);
  if (!snapshot.success || !belongsTo(snapshot.data, holder)) {
    logError('refreshTodayOnDevice: unexpected snapshot', { readable: snapshot.success });
    return 'kept';
  }
  return (await saveUnlessWiped(snapshot.data, now(), { holder, generation })) ? 'saved' : 'superseded';
}
