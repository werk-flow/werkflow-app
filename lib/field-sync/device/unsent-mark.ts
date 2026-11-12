'use client';

import type { KeptClockAction } from './kept-clock-actions';
import { TODAY_WIPE_KEY } from './today-wipe';

// What every page carries of the phone's unsent work, so this module imports
// no code and stays a few lines: the read of the hint that decides at the app
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

/** Every key of localStorage. Throws where the browser refuses the storage. */
export function storageKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '');
}

/** Whether the app start should load the sync runner. True when the hint cannot be read. */
export function deviceMayHoldUnsentWork(): boolean {
  try {
    return storageKeys().some((key) => key.startsWith(UNSENT_MARK_PREFIX));
  } catch {
    return true;
  }
}

/** The latest wipe signal of the origin (today-wipe.ts), or null when localStorage cannot be read. */
export function wipeSignal(): string | null {
  try {
    return localStorage.getItem(TODAY_WIPE_KEY) ?? '';
  } catch {
    return null;
  }
}

/**
 * Keeps one clock action on the device under the wipe signal `pageSignal` the page started with.
 * False when the device cannot store it, or when a sign-out or switch in another tab wiped since
 * then: this page's person may no longer be the one signed in. The action is then not recorded,
 * and the clock says so.
 */
export function keepClockAction(
  action: Omit<KeptClockAction, 'wipeGeneration'>,
  pageSignal: string,
): boolean {
  if (wipeSignal() !== pageSignal) return false;
  keptOnThisPage += 1;
  const order = `${String(Date.parse(action.capturedAt)).padStart(15, '0')}:${keptOnThisPage}`;
  try {
    localStorage.setItem(
      `${KEPT_CLOCK_ACTION_PREFIX}${order}:${action.operationId}`,
      JSON.stringify({ ...action, wipeGeneration: pageSignal } satisfies KeptClockAction),
    );
    return true;
  } catch {
    return false;
  }
}
