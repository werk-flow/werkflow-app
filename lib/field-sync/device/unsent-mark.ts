'use client';

// The hint that this device may hold unsent work, one localStorage key per
// kind. Every page reads it at start to decide whether the sync runner's code
// loads at all, so this module imports nothing and stays a few lines. It is a
// hint only: the outbox itself is the truth, and a sign-out always asks it.

const UNSENT_MARK_PREFIX = 'werkflow:unsent:';

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
