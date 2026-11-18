'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useUserProfile } from '@/components/user/user-profile-context';
import { useClientRead } from '@/hooks/use-client-read';
import { TODAY_HOLDER_KEY, TODAY_WIPE_KEY } from '@/lib/field-sync/device/today-wipe';
import { logError } from '@/lib/logging';

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

/**
 * The day the start page may show: the device's day, only while it belongs to this tab's person and
 * employee organization. The device claim is browser-wide, so another tab's organization can own
 * it; a lost membership or role changes the organization context and hides the day at once.
 */
export function useWorkerStartDay() {
  const userId = useUserProfile().profile?.id ?? null;
  const { activeOrg } = useOrganization();
  const organizationId = activeOrg?.role === 'employee' ? activeOrg.orgId : null;
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

  const read = day.data?.stored ?? null;
  const stored =
    read && read.snapshot.userId === userId && read.snapshot.organizationId === organizationId ? read : null;
  // Berlin midnight ends the day: the read then deletes it and answers none.
  useEffect(() => {
    if (!stored) return;
    const remaining = Date.parse(stored.snapshot.validUntil) - Date.now();
    const timer = window.setTimeout(reload, Math.min(Math.max(remaining, 0), MAX_TIMER_MS));
    return () => window.clearTimeout(timer);
  }, [stored, reload]);

  // A day this page showed and the device no longer holds: it ended, and only the next start fetches a new one.
  const scope = `${userId}:${organizationId}`;
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (stored && shownFor !== scope) setShownFor(scope);

  return {
    stored,
    settled: day.data !== undefined,
    ended: !stored && day.data !== undefined && shownFor === scope,
    failure: day.failure,
  };
}
