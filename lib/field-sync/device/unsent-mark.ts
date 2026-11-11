'use client';

import type { KeptClockAction } from './kept-clock-actions';
import { TODAY_WIPE_KEY } from './today-wipe';

// What every page carries of the phone's unsent work, so this module imports
// no code and stays a few lines: the hint that decides at the app start
// whether the sync runner's code loads at all, and the one write a clock
// action needs when the signal is already gone and no code can load any more.
// The outbox (time-outbox.ts) takes such a kept action in as soon as its code
// runs: at the next app start with signal, on `online`, on the page a phone
// shows without signal, and before a session ends.

const UNSENT_MARK_PREFIX = 'werkflow:unsent:';

/** The clock actions pages kept and the outbox has not taken in yet, as a JSON list. */
export const KEPT_CLOCK_ACTIONS_KEY = `${UNSENT_MARK_PREFIX}clock`;

/** Records whether the device holds unsent work of this kind, of any person. */
export function markUnsentWork(kind: string, holds: boolean): void {
  try {
    if (holds) localStorage.setItem(UNSENT_MARK_PREFIX + kind, '1');
    else localStorage.removeItem(UNSENT_MARK_PREFIX + kind);
  } catch {
    // best-effort: without localStorage the app start does not send; the next clock action and every sign-out still read the outbox.
  }
}

/** Whether the app start should load the sync runner. True when the hint cannot be read. */
export function deviceMayHoldUnsentWork(): boolean {
  try {
    return Object.keys(localStorage).some((key) => key.startsWith(UNSENT_MARK_PREFIX));
  } catch {
    return true;
  }
}

/**
 * Keeps one clock action on the device, after the ones kept before it, with the time of this call
 * as its captured time and the wipe signal it was kept under. False when the device cannot store
 * it: the action is then not recorded, and the clock says so.
 */
export function keepClockAction(action: Omit<KeptClockAction, 'capturedAt' | 'wipeGeneration'>): boolean {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEPT_CLOCK_ACTIONS_KEY) ?? '[]');
    const kept: unknown[] = Array.isArray(stored) ? stored : [];
    const next: KeptClockAction = {
      ...action,
      capturedAt: new Date().toISOString(),
      wipeGeneration: localStorage.getItem(TODAY_WIPE_KEY) ?? '',
    };
    localStorage.setItem(KEPT_CLOCK_ACTIONS_KEY, JSON.stringify([...kept, next]));
    return true;
  } catch {
    return false;
  }
}
