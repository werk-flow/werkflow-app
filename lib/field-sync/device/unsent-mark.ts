'use client';

import type { TimeTransitionResult } from '@/lib/time-tracking/types';
import type { KeptClockAction } from './kept-clock-actions';
import { sharedWipeGeneration } from './today-wipe';

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

/** Whether the app start should load the sync runner. True when the hint cannot be read. */
export function deviceMayHoldUnsentWork(): boolean {
  try {
    for (let index = 0; index < localStorage.length; index += 1)
      if (localStorage.key(index)?.startsWith(UNSENT_MARK_PREFIX)) return true;
    return false;
  } catch {
    return true;
  }
}

/**
 * Keeps one clock action on the device under the wipe signal `pageSignal` the page started with,
 * and answers as the accepted action would, or null when it keeps nothing. Only a start, a switch
 * and an end can wait for signal. Nothing is kept when the device cannot store it, or when a
 * sign-out or switch in another tab wiped since then: this page's person may no longer be the one
 * signed in. The first kept action stands on `base`, the clock the server confirmed, which is kept
 * without job, customer and project names.
 */
export function keepClockAction(
  action: Omit<KeptClockAction, 'wipeGeneration'>,
  pageSignal: string,
): Extract<TimeTransitionResult, { success: true }> | null {
  const kind = action.action;
  if ((kind !== 'start' && kind !== 'switch' && kind !== 'end') || sharedWipeGeneration() !== pageSignal)
    return null;
  const base = action.base && { ...action.base, activeJobInfo: null, resumeJobInfo: null };
  keptOnThisPage += 1;
  const order = `${String(Date.parse(action.capturedAt)).padStart(15, '0')}:${keptOnThisPage}`;
  try {
    localStorage.setItem(
      `${KEPT_CLOCK_ACTION_PREFIX}${order}:${action.operationId}`,
      JSON.stringify({ ...action, base, wipeGeneration: pageSignal } satisfies KeptClockAction),
    );
  } catch {
    return null;
  }
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
