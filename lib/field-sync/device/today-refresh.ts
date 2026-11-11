'use client';

import { logError } from '@/lib/logging';
import { readPersistenceOnDevice, savePersistenceOnDevice } from './today-store';
import { claimToday, refreshTodayOnDevice, type TodayHolder } from './today-sync';
import { TODAY_HOLDER_KEY, todayWipeGeneration } from './today-wipe';

// Keeps the phone's today snapshot current while the app is open (decision
// record 0010, "Sync triggers"): on app start and on `online`. A return to
// the visible app is the Realtime provider's catch-up for the page on screen
// (client freshness contract rule 2); the next app start or `online` refreshes
// the snapshot. There is no background sync.

function installedAsApp(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

/**
 * Asks once, in the installed app, that the browser keep the snapshot under
 * storage pressure, and records the answer. A refusal is a normal state.
 */
async function askForPersistence(now: Date): Promise<void> {
  if (!installedAsApp() || typeof navigator.storage?.persist !== 'function') return;
  if (await readPersistenceOnDevice()) return;
  const granted = await navigator.storage.persist();
  await savePersistenceOnDevice(granted, now);
}

/** Told when the device could not store the day, so the person learns it while there is signal. */
export type TodayStorageFailure = (retry: () => void) => void;

let holder: TodayHolder | null = null;
let reportFailure: TodayStorageFailure | null = null;
let running = false;
let again = false;

function refreshNow(): void {
  const current = holder;
  if (!current) return;
  // A trigger during a refresh, such as the start page after an organization switch, runs once it ends.
  if (running) {
    again = true;
    return;
  }
  running = true;
  void refreshTodayOnDevice(current)
    .then(async (outcome) => {
      if (outcome === 'saved' || outcome === 'confirmed') await askForPersistence(new Date());
    })
    .catch((error: unknown) => {
      // A full disk (`QuotaExceededError`) or a refused storage: the person must know before the signal goes.
      logError('keepTodayFresh: device storage failed', error);
      reportFailure?.(refreshNow);
    })
    .finally(() => {
      running = false;
      if (again) {
        again = false;
        refreshNow();
      }
    });
}

/**
 * Refreshes the snapshot now, and again on every `online`, for the person and
 * organization the latest start page was rendered for, unless the device was
 * wiped since `generationAtStart` (`todayWipeGeneration()` when the page
 * started loading this code). A storage failure goes to `onFailure` with a retry.
 */
export function keepTodayFresh(
  next: TodayHolder,
  onFailure: TodayStorageFailure,
  generationAtStart: string,
): void {
  // A sign-out that wiped while this code loaded ends the session next: its page must not claim
  // the device again while that session still answers.
  if (todayWipeGeneration() !== generationAtStart) return;
  if (!holder) window.addEventListener('online', refreshNow);
  holder = next;
  claimToday(next);
  reportFailure = onFailure;
  refreshNow();
}

/**
 * Ends this tab's claim after another tab wiped the device (decision record 0010, the 2026-11-11
 * amendment). No refresh saves again until a start page claims anew, a refresh in flight no longer
 * owns the device, and no reader shows a day saved under the dropped claim. It never writes the
 * wipe signal: two tabs answering each other's signal would never stop.
 */
export function dropTodayClaim(): void {
  holder = null;
  try {
    localStorage.removeItem(TODAY_HOLDER_KEY);
  } catch {
    // best-effort: without localStorage no reader can confirm a claim, so none shows a day.
  }
}
