'use client';

import { timeActivitySelectionSchema } from '@/lib/time-tracking/activity-selection-schema';
import { z } from '@/lib/zod';
import { captureTimeEvent, isOfflineClockAction } from './time-outbox';
import { storedClockSchema, storedVersionSchema } from './stored-clock';
import { KEPT_CLOCK_ACTION_PREFIX, UNSENT_MARK_PREFIX, clockCallLock } from './unsent-mark';

// Takes the clock actions a page kept without signal (unsent-mark.ts) into the
// time outbox. A page that loses its signal can load no code any more, so it
// writes the action to localStorage with the few lines it carries; this module
// moves it into the outbox, whose rules need IndexedDB. An action's key goes
// only after the outbox holds it.

const keptClockActionSchema = z.object({
  /** The stored format's version (stored-clock.ts). */
  version: storedVersionSchema,
  userId: z.string(),
  organizationId: z.string(),
  /** Created when the person acted; the outbox and every send keep it. */
  operationId: z.string(),
  action: z.string(),
  selection: timeActivitySelectionSchema.nullable(),
  expectedSessionId: z.string().nullable(),
  expectedVersion: z.number().nullable(),
  capturedAt: z.string(),
  /** The online clock call was tried first, under the same operation id. */
  triedOnline: z.boolean(),
  /** Written before the online call and gone once it answered: an entry left behind belongs to a page that closed mid-call. */
  inFlight: z.boolean().optional(),
  /** The wipe signal when the person acted (today-wipe.ts). */
  wipeGeneration: z.string(),
  /** The clock the server last confirmed, as the page read it; null when the page held none. */
  base: storedClockSchema.nullable(),
  /** When the page read `base` from the server (time-outbox.ts, TimeEventCapture). */
  readAt: z.string().nullable(),
});

/** One clock action as a page keeps it when it meets no network. */
export type KeptClockAction = z.infer<typeof keptClockActionSchema>;

/** What a page hands over to keep: the store adds the format's version and the wipe signal. */
export type ClockActionToKeep = Omit<KeptClockAction, 'version' | 'wipeGeneration'>;

/** The keys of the kept clock actions, in the order of their taps. */
function keptActionKeys(): string[] {
  return keysWith(KEPT_CLOCK_ACTION_PREFIX);
}

function readKeptAction(key: string): KeptClockAction | null {
  try {
    const kept = keptClockActionSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
    return kept.success && isOfflineClockAction(kept.data.action) ? kept.data : null;
  } catch {
    return null;
  }
}

/** How long, without Web Locks, an entry written before an online call counts as its page's still. */
const CALL_WITHOUT_LOCKS_MS = 2 * 60 * 1000;

/** How long an entry counts as its page's while that page's call lock may not be granted yet. */
const CALL_LOCK_GRANT_MS = 10 * 1000;

/**
 * Whether the page that wrote this entry before its online call may still hold that call open, and
 * when to look again: at `recheckAt` for an entry too young to judge, or once `lock` is free.
 */
type CallState = { runs: false } | { runs: true; recheckAt: number | null; lock: string | null };

async function callState(kept: Pick<KeptClockAction, 'operationId' | 'capturedAt'>): Promise<CallState> {
  const capturedAt = Date.parse(kept.capturedAt);
  const age = Date.now() - capturedAt;
  if (typeof navigator.locks?.request !== 'function')
    return age < CALL_WITHOUT_LOCKS_MS
      ? { runs: true, recheckAt: capturedAt + CALL_WITHOUT_LOCKS_MS, lock: null }
      : { runs: false };
  if (age < CALL_LOCK_GRANT_MS) return { runs: true, recheckAt: capturedAt + CALL_LOCK_GRANT_MS, lock: null };
  const lock = clockCallLock(kept.operationId);
  const held = await navigator.locks.request(lock, { ifAvailable: true }, (granted) => granted === null);
  return held ? { runs: true, recheckAt: null, lock } : { runs: false };
}

/** What a take-in left kept: an online call still open and every action behind it, and when to look again. */
export type DeferredTakeIn = { actions: KeptClockAction[]; recheckAt: number | null; lock: string | null };

/**
 * The prefix of the records the person set aside: kept actions this version could not read, moved
 * out of the kept store so they hold nothing back (decision record 0010, "an unreadable clock record
 * set aside"). No version takes one in or sends it, because it would reach the server after the taps
 * that followed it; the person settles its time through the correction. It sits under the unsent
 * mark, so the app start still loads the code that shows it.
 */
const SET_ASIDE_CLOCK_ACTION_PREFIX = `${UNSENT_MARK_PREFIX}clock-aside:`;

/**
 * A kept action this version cannot read, or one the person set aside: its key, the time of its tap,
 * and its person when that much reads. A stop holds the person's later taps; a set-aside record does not.
 */
export type UnreadableKeptAction = {
  key: string;
  capturedAt: string;
  userId: string | null;
  setAside: boolean;
};

/** The person a stored value names, when it is JSON with a string `userId`. */
function personNamedIn(key: string): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (typeof value !== 'object' || value === null || !('userId' in value)) return null;
    const userId: unknown = value.userId;
    return typeof userId === 'string' ? userId : null;
  } catch {
    return null;
  }
}

/** The keys under `prefix`, in the order of their taps. */
function keysWith(prefix: string): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '')
    .filter((key) => key.startsWith(prefix))
    .toSorted();
}

/**
 * The kept actions this version cannot read, and the records set aside, that may be `userId`'s:
 * theirs, or of a person the value does not name. A stop holds the take-in, so the clock shows it and
 * the person can set it aside or delete it; a set-aside record shows until the person deletes it,
 * also once a later version could read it.
 */
export function unreadableKeptActions(userId: string | null): UnreadableKeptAction[] {
  const stops = keptActionKeys().filter((key) => readKeptAction(key) === null);
  const setAside = keysWith(SET_ASIDE_CLOCK_ACTION_PREFIX);
  return [...stops, ...setAside]
    .map((key) => ({
      key,
      capturedAt: new Date(tapTimeOf(key)).toISOString(),
      userId: personNamedIn(key),
      setAside: key.startsWith(SET_ASIDE_CLOCK_ACTION_PREFIX),
    }))
    .filter((action) => action.userId === null || action.userId === userId);
}

/**
 * Deletes the unreadable kept actions and the set-aside records among `keys`, the ones the person
 * was shown; a kept action that reads now stays.
 */
export function removeUnreadableKeptActions(keys: readonly string[]): void {
  for (const key of keys)
    if (
      key.startsWith(SET_ASIDE_CLOCK_ACTION_PREFIX) ||
      (key.startsWith(KEPT_CLOCK_ACTION_PREFIX) && readKeptAction(key) === null)
    )
      localStorage.removeItem(key);
}

/** What a set-aside answers: done, or why the record stayed a stop. */
export type SetAsideOutcome = 'set_aside' | 'gone' | 'sending';

/**
 * Sets aside the unreadable kept action under `key` that `userId` was shown: its record moves, as it
 * is, out of the kept store, so it holds no later tap and no version sends it. An action whose online
 * call may still run stays a stop (`sending`): its page may yet record it, or keep it anew. One that
 * reads now, or is gone, stays as it is (`gone`). The copy is written before the key goes, so a full
 * storage throws and leaves the stop.
 */
export async function setAsideUnreadableKeptAction(key: string, userId: string): Promise<SetAsideOutcome> {
  const value = localStorage.getItem(key);
  const owner = personNamedIn(key);
  if (
    value === null ||
    !key.startsWith(KEPT_CLOCK_ACTION_PREFIX) ||
    readKeptAction(key) !== null ||
    (owner !== null && owner !== userId)
  )
    return 'gone';
  const operationId = key.slice(KEPT_CLOCK_ACTION_PREFIX.length).split(':').slice(2).join(':');
  const call = await callState({ operationId, capturedAt: new Date(tapTimeOf(key)).toISOString() });
  if (call.runs) return 'sending';
  // Another tab may have deleted or rewritten the stop meanwhile; from here on nothing else runs before the move ends.
  if (localStorage.getItem(key) !== value) return 'gone';
  localStorage.setItem(SET_ASIDE_CLOCK_ACTION_PREFIX + key.slice(KEPT_CLOCK_ACTION_PREFIX.length), value);
  localStorage.removeItem(key);
  return 'set_aside';
}

/**
 * The record under `key` as stored, for the person to hand to support: an unreadable kept action or a
 * set-aside record, never another key. Null when it is gone.
 */
export function storedClockRecord(key: string): string | null {
  if (!key.startsWith(KEPT_CLOCK_ACTION_PREFIX) && !key.startsWith(SET_ASIDE_CLOCK_ACTION_PREFIX))
    return null;
  return localStorage.getItem(key);
}

/**
 * A kept action this version cannot read, as a stop: nothing of `userId` tapped at or after `at`
 * passes it. A stop without a person (`userId` null) holds everyone's.
 */
type KeptStop = { userId: string | null; at: number };

/**
 * What a take-in did: how many actions it moved, how many it cannot read, what waits behind an open
 * online call or a stop, and the stops themselves.
 */
export type KeptTakeIn = {
  moved: number;
  unreadable: number;
  deferred: DeferredTakeIn | null;
  stops: KeptStop[];
};

/** The tap time from which nothing of `userId` passes, or null when no stop holds them. */
export function stopFor({ stops }: Pick<KeptTakeIn, 'stops'>, userId: string): number | null {
  const times = stops.filter((stop) => stop.userId === null || stop.userId === userId).map((stop) => stop.at);
  return times.length > 0 ? Math.min(...times) : null;
}

/** The tap time a kept or set-aside action's key names (unsent-mark.ts), or 0 for a key that names none: then nothing passes it. */
function tapTimeOf(key: string): number {
  const prefix = key.startsWith(SET_ASIDE_CLOCK_ACTION_PREFIX)
    ? SET_ASIDE_CLOCK_ACTION_PREFIX
    : KEPT_CLOCK_ACTION_PREFIX;
  const tapped = Number(key.slice(prefix.length).split(':')[0]);
  return Number.isFinite(tapped) ? tapped : 0;
}

/**
 * Moves every kept clock action into its person's outbox, in the order of the taps, and answers
 * how many it moved and how many it cannot read. An action this version cannot read stays kept: it
 * is never dropped unread, and a session must not end over it (clock-device.ts). Throws when the
 * device storage fails; the actions then stay kept.
 */
export async function takeInKeptClockActions(
  /**
   * Marks the device as holding unsent work and answers whether the mark is written; runs before a
   * key goes, so a tab closed mid-intake never hides the event.
   */
  markHeld: () => boolean,
): Promise<KeptTakeIn> {
  let moved = 0;
  const stops: KeptStop[] = [];
  /** Readable actions a stop of their person holds: they stay kept, and a session end counts them. */
  const held: KeptClockAction[] = [];
  const keys = keptActionKeys();
  for (const [index, key] of keys.entries()) {
    const kept = readKeptAction(key);
    if (!kept) {
      const owner = personNamedIn(key);
      stops.push({ userId: owner, at: tapTimeOf(key) });
      // A stop of one person holds only that person's later actions; one without a person holds all.
      if (owner !== null) continue;
      const later = keys.slice(index + 1).map(readKeptAction);
      const behind = later.filter((action): action is KeptClockAction => action !== null);
      const waiting = [...held, ...behind];
      return {
        moved,
        unreadable: stops.length + later.length - behind.length,
        deferred: waiting.length > 0 ? { actions: waiting, recheckAt: null, lock: null } : null,
        stops,
      };
    }
    if (stops.some((stop) => stop.userId === kept.userId)) {
      held.push(kept);
      continue;
    }
    const { userId, organizationId, action, base, readAt, capturedAt, triedOnline, wipeGeneration } = kept;
    const { operationId, selection, expectedSessionId, expectedVersion, inFlight } = kept;
    const command = { operationId, selection, expectedSessionId, expectedVersion };
    if (!isOfflineClockAction(action)) continue;
    // Its page may still wait for the server's answer; what was kept after it waits behind it.
    const call = inFlight ? await callState(kept) : { runs: false as const };
    if (call.runs) {
      const later = keys.slice(index + 1).map(readKeptAction);
      // An action behind the call that this version cannot read still counts: a session end fails closed on it.
      const behind = later.filter((action): action is KeptClockAction => action !== null);
      return {
        moved,
        unreadable: stops.length + later.length - behind.length,
        deferred: { actions: [...held, kept, ...behind], recheckAt: call.recheckAt, lock: call.lock },
        stops,
      };
    }
    await captureTimeEvent(
      { userId, organizationId },
      {
        command: { ...command, action },
        base,
        readAt: readAt === null ? null : new Date(readAt),
        capturedAt: new Date(capturedAt),
        triedOnline,
        wipeGeneration,
      },
    );
    // Only after the outbox holds it and the start-up hint says so; a second take-in keeps it once there.
    // A full storage: the key stays, and the next take-in finds the action in the outbox already.
    if (!markHeld()) throw new Error('the start-up hint for unsent work cannot be written');
    localStorage.removeItem(key);
    moved += 1;
  }
  return {
    moved,
    unreadable: stops.length,
    deferred: held.length > 0 ? { actions: held, recheckAt: null, lock: null } : null,
    stops,
  };
}

/**
 * Resolves once the online call that wrote `action` down before it ran can be judged: after its
 * first seconds, when its page may not hold the call's lock yet, and then once the page let go of
 * that lock. At once for an action kept without a call, or whose call already answered.
 */
export async function untilOwnCallAnswers(action: KeptClockAction): Promise<void> {
  const call = action.inFlight ? await callState(action) : { runs: false as const };
  if (!call.runs) return;
  if (call.recheckAt !== null) {
    const wait = Math.max(0, call.recheckAt - Date.now());
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }
  if (typeof navigator.locks?.request === 'function')
    await navigator.locks.request(clockCallLock(action.operationId), async () => undefined);
}

/**
 * Deletes the readable kept actions whose operation ids `operationIds` names. The caller holds the
 * take-in's lock, so no take-in moves one of them into the outbox meanwhile.
 */
export function removeKeptActions(operationIds: readonly string[]): void {
  for (const key of keptActionKeys()) {
    const kept = readKeptAction(key);
    if (kept && operationIds.includes(kept.operationId)) localStorage.removeItem(key);
  }
}
