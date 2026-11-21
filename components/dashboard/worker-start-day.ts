'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import type { StoredToday } from '@/lib/field-sync/device/today-store';
import { TODAY_HOLDER_KEY, TODAY_WIPE_KEY } from '@/lib/field-sync/device/today-wipe';
import { logError } from '@/lib/logging';
import { FIRST_REFRESH_WAIT_MS } from './worker-start-timing';

// The field worker's day as the start page shows it: the phone's today
// snapshot, read through E7's seam only (werk-flow/werkflow-planning#22):
// `readTodayOnDevice()`, and again after each `onTodaySaved()`. Both load with
// this code, after the page is usable; the server render carries none of it.

/** The longest delay `setTimeout` keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Whether the browser reports a connection; the server render assumes one. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** Reads the device again after each refresh in this tab that saved the day (E7's `onTodaySaved`). */
function useReadOnSave(reload: () => void): void {
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    import('@/lib/field-sync/device/today-refresh').then(
      ({ onTodaySaved }) => {
        if (!active) return;
        unsubscribe = onTodaySaved(reload);
        // A refresh that saved while this code loaded told no one: read once more.
        reload();
      },
      (error: unknown) => {
        // The start page's refresh fails on the same code and shows its own banner; the first read stands.
        logError('WorkerStart: refresh signal failed to load', error);
      },
    );
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [reload]);
}

/**
 * Drops the shown day at once and reads again after a sign-out or organization switch in another tab
 * (its wipe signal or a change of the device claim), and after a return from the back-forward cache.
 */
function useDropOnWipe(dropAndReadAgain: () => void): void {
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      // A wipe removes the claim first; `localStorage.clear()` reports no key.
      if (event.key === TODAY_WIPE_KEY || event.key === TODAY_HOLDER_KEY || event.key === null)
        dropAndReadAgain();
    };
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) dropAndReadAgain();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [dropAndReadAgain]);
}

/**
 * The day the start page may show: the device's day, only while it belongs to this tab's person and
 * employee organization. The device claim is browser-wide, so another tab's organization can own
 * it; a lost membership or role changes the organization context and hides the day at once.
 * `organizationId` is the active organization while the person is its `employee`, else null.
 */
export function useWorkerStartDay(userId: string | null, organizationId: string | null) {
  // A sign-out or organization switch in another tab drops the shown day at once (a deps change).
  const [wipes, setWipes] = useState(0);
  const dropAndReadAgain = useCallback(() => setWipes((count) => count + 1), []);
  const day = useClientRead({
    read: async () => {
      try {
        const { readTodayOnDevice } = await import('@/lib/field-sync/device/today-store');
        return { success: true as const, stored: await readTodayOnDevice() };
      } catch (error) {
        logError('WorkerStart: device storage failed', error);
        return { success: false as const, error: 'load_failed' };
      }
    },
    deps: [wipes, userId, organizationId],
    failureMessage: 'Der Speicher deines Geräts hat nicht geantwortet.',
  });
  const { reload } = day;

  useReadOnSave(reload);
  useDropOnWipe(dropAndReadAgain);

  // The day whose end passed: hidden at once, also when the re-read after it fails and keeps the last data.
  const [expired, setExpired] = useState<StoredToday | null>(null);
  const read = day.data?.stored ?? null;
  const stored =
    read &&
    read !== expired &&
    read.snapshot.userId === userId &&
    read.snapshot.organizationId === organizationId
      ? read
      : null;
  // Berlin midnight ends the day: the read then deletes it and answers none.
  useEffect(() => {
    if (!stored) return;
    const remaining = Date.parse(stored.snapshot.validUntil) - Date.now();
    const timer = window.setTimeout(
      () => {
        setExpired(stored);
        reload();
      },
      Math.min(Math.max(remaining, 0), MAX_TIMER_MS),
    );
    return () => window.clearTimeout(timer);
  }, [stored, reload]);

  // No day yet: give the first refresh its chance, then stop showing the day as loading.
  const [waited, setWaited] = useState(false);
  const hasDay = stored !== null;
  useEffect(() => {
    if (hasDay) return;
    const timer = window.setTimeout(() => setWaited(true), FIRST_REFRESH_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [hasDay]);

  // A day this page showed and the device no longer holds: it ended, and only the next start fetches a new one.
  const scope = `${userId}:${organizationId}`;
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (stored && shownFor !== scope) setShownFor(scope);

  return {
    stored,
    settled: day.data !== undefined,
    ended: !stored && (day.data !== undefined || expired !== null) && shownFor === scope,
    /** The first refresh had its chance and no day arrived. */
    waited,
    failure: day.failure,
  };
}
