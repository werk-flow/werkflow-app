'use client';

import type { TimeTransitionResult } from '@/lib/time-tracking/types';
import type { ClockActionToKeep, KeptClockAction } from './kept-clock-actions';
import type { StoredClockFacts } from './stored-clock';
import { STORED_RECORD_VERSION, storedClockFacts } from './stored-clock-facts';
import { mayKeepUnder } from './today-wipe';

// What every page carries of the phone's unsent work, so this module imports
// only the static wipe signal (today-wipe.ts) and stays a few lines: the read of the hint that decides at the app
// start whether the sync runner's code loads at all (sync-runner.ts sets the
// hint), and the one write a clock action needs when the signal is already
// gone and no code can load any more. The outbox (time-outbox.ts) takes such a
// kept action in as soon as its code runs: at the next app start with signal,
// on `online`, on the page a phone shows without signal, and before a session
// ends.

/** The prefix of every localStorage key that says the device may hold unsent work. */
export const UNSENT_MARK_PREFIX = 'werkflow:unsent:';

/**
 * The prefix of the keys of kept clock actions, one key per action: two tabs that keep at once
 * never write the same key, so neither overwrites the other's action. The key sorts by the time of
 * the tap.
 */
export const KEPT_CLOCK_ACTION_PREFIX = `${UNSENT_MARK_PREFIX}clock:`;

let keptOnThisPage = 0;

/**
 * Whether kept actions wait that the outbox has not taken in: one another tab's call holds, one this
 * version cannot read, or one kept without signal. A new tap then goes behind them, never online
 * ahead of them. True when the store cannot be read.
 */
export function keptActionsWait(): boolean {
  return holdsKeyWith(KEPT_CLOCK_ACTION_PREFIX);
}

/**
 * Whether the phone holds unsent time events: the time hint the outbox keeps, or a kept clock action
 * it has not taken in. The page after a sign-out shows it (components/auth/unsent-time-landing-notice.tsx).
 */
export function deviceHoldsUnsentTime(): boolean {
  try {
    return localStorage.getItem(`${UNSENT_MARK_PREFIX}time`) !== null || keptActionsWait();
  } catch {
    return false;
  }
}

/** Whether the app start should load the sync runner. True when the hint cannot be read. */
export function deviceMayHoldUnsentWork(): boolean {
  return holdsKeyWith(UNSENT_MARK_PREFIX);
}

/** Whether any localStorage key starts with `prefix`. True when the store cannot be read: a reader then assumes work waits. */
function holdsKeyWith(prefix: string): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1)
      if (localStorage.key(index)?.startsWith(prefix)) return true;
    return false;
  } catch {
    return true;
  }
}

/** A kept action in its stored format (stored-clock.ts): the clock without job, customer and project names. */
function keptValue(action: ClockActionToKeep, pageSignal: string): string {
  const stored: Omit<KeptClockAction, 'base'> & { base: StoredClockFacts | null } = {
    ...action,
    version: STORED_RECORD_VERSION,
    base: action.base && storedClockFacts(action.base),
    wipeGeneration: pageSignal,
  };
  return JSON.stringify(stored);
}

/** Writes one kept action; answers its key, or null when nothing may or can be kept. */
function storeKept(action: ClockActionToKeep, pageSignal: string): string | null {
  const kind = action.action;
  if ((kind !== 'start' && kind !== 'switch' && kind !== 'end') || !mayKeepUnder(pageSignal)) return null;
  keptOnThisPage += 1;
  const key = `${KEPT_CLOCK_ACTION_PREFIX}${String(Date.parse(action.capturedAt)).padStart(15, '0')}:${keptOnThisPage}:${action.operationId}`;
  try {
    localStorage.setItem(key, keptValue(action, pageSignal));
    return key;
  } catch {
    return null;
  }
}

/** The Web Lock an online clock call holds while it runs: a take-in leaves its action to the page until then. */
export function clockCallLock(operationId: string): string {
  return `werkflow-clock-call:${operationId}`;
}

/**
 * Runs the online clock call with its action written down first, under the same operation id, so
 * a page that closes or loses its signal mid-call leaves it for the next start. The entry goes when
 * the server answered or the call failed; a failed call is then kept as usual.
 */
export function callWhileKept<T>(
  action: ClockActionToKeep,
  pageSignal: string | null,
  call: () => Promise<T>,
): Promise<T | KeptClockResult> {
  // Another tab ended the session, or is making its last check: no action leaves this page without its trace.
  if (pageSignal !== null && !mayKeepUnder(pageSignal))
    return Promise.reject(new Error('another tab ended the session, or is ending it'));
  const key = pageSignal === null ? null : storeKept({ ...action, inFlight: true }, pageSignal);
  // The call starts in the tap's own task, so its feedback stays in the first frame.
  const answered = call().then(
    (answer) => {
      if (key) localStorage.removeItem(key);
      return answer;
    },
    (failure: unknown) => {
      // No answer: the entry written before the call is the kept action. It is never removed and
      // kept anew, which a session end's barrier would refuse.
      if (!key || pageSignal === null) throw failure;
      try {
        localStorage.setItem(key, keptValue({ ...action, inFlight: false }, pageSignal));
      } catch {
        // best-effort: an entry still marked in flight is taken in once this page let go of its call.
      }
      return keptResult(action.action);
    },
  );
  // The lock tells other tabs the page still waits; a take-in also leaves a fresh entry alone until it is granted.
  if (key && typeof navigator.locks?.request === 'function')
    void navigator.locks.request(clockCallLock(action.operationId), () =>
      answered.then(
        () => undefined,
        () => undefined,
      ),
    );
  return answered;
}

/**
 * Keeps one clock action on the device under the wipe signal `pageSignal` the page started with,
 * and answers as the accepted action would, or null when it keeps nothing. Only a start, a switch
 * and an end can wait for signal. Nothing is kept when the device cannot store it, or when a
 * sign-out or switch in another tab wiped since then: this page's person may no longer be the one
 * signed in. `base`, the clock the server confirmed, is kept without job, customer and project names.
 */
export function keepClockAction(
  action: ClockActionToKeep,
  pageSignal: string,
): Extract<TimeTransitionResult, { success: true }> | null {
  if (!storeKept(action, pageSignal)) return null;
  return keptResult(action.action);
}

/** What a kept clock action answers: as the server would have, without a session it cannot know yet. */
type KeptClockResult = Extract<TimeTransitionResult, { success: true }>;

function keptResult(kind: string): KeptClockResult {
  return {
    success: true,
    kept: true,
    outcome: kind === 'end' ? 'ended' : 'active',
    sessionId: null,
    segmentId: null,
    version: null,
    recoveryReason: null,
    replayed: false,
    legacyBridged: false,
  };
}
