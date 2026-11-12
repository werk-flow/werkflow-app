'use client';

import { useEffect } from 'react';

import { logError } from '@/lib/logging';

// The device-level mark of the report drafts a phone keeps (decision record
// 0010, the report draft amendment): one localStorage key without a person
// that says the device may hold a draft of anyone. The start of any person's
// app reads it and only then loads the draft store, which deletes every
// lost-access draft past its seven days, of every holder. The `(auth)`
// landing page loads this module statically and the store lazily; a job page
// reads the same key itself (use-device-drafts.ts) and then loads the draft
// code, whose send pass deletes the same drafts.

/** Set while the device may hold a draft of anyone; never names a person. use-device-drafts.ts reads it by this key. */
const DRAFTS_ON_DEVICE_KEY = 'werkflow:drafts-on-device';

/** Sets or removes the device mark; the draft store calls it with every write. */
export function markDraftsOnDevice(held: boolean): void {
  try {
    if (held) localStorage.setItem(DRAFTS_ON_DEVICE_KEY, '1');
    else localStorage.removeItem(DRAFTS_ON_DEVICE_KEY);
  } catch {
    // best-effort: without localStorage a job page still sweeps when it loads the draft code.
  }
}

function deviceMayHoldDrafts(): boolean {
  try {
    return localStorage.getItem(DRAFTS_ON_DEVICE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Deletes every lost-access draft past its seven days, of every holder, when the device mark says
 * the phone may hold drafts. It never sends, lists or changes a live draft.
 */
async function sweepDraftsOfDevice(): Promise<void> {
  if (!deviceMayHoldDrafts()) return;
  const { sweepExpiredDraftsOnDevice } = await import('./draft-store');
  await sweepExpiredDraftsOnDevice();
}

/** Runs the sweep once per mount; a failure is logged and the next start tries again. */
export function useDraftSweepOfDevice(): void {
  useEffect(() => {
    sweepDraftsOfDevice().then(
      () => undefined,
      (error: unknown) => logError('Draft expiry sweep failed', error),
    );
  }, []);
}
