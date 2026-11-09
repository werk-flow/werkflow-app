'use client';

import { useEffect } from 'react';

import { useBanner } from '@/components/ui/banner';
import { logError } from '@/lib/logging';

/**
 * Keeps the field worker's today snapshot on the phone current from app
 * start (decision record 0010, "Sync triggers"). Its code loads after the
 * page is usable, so the start page renders no byte of it. It renders nothing
 * itself; a day the device could not store shows as an error banner with a retry.
 */
export function TodayRefreshOnStart({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): null {
  const { showBanner } = useBanner();
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { keepTodayFresh } = await import('@/lib/field-sync/device/today-refresh');
        if (current)
          keepTodayFresh({ userId, organizationId }, (retry) =>
            showBanner({
              variant: 'error',
              message:
                'Deine Einsätze von heute konnten nicht auf dem Gerät gespeichert werden. Ohne Netz siehst du sie nicht.',
              actionLabel: 'Erneut versuchen',
              onAction: retry,
            }),
          );
      } catch (error) {
        // best-effort: a chunk gone after a deployment leaves the phone with the day it has until the next start.
        logError('TodayRefreshOnStart: refresh module failed to load', error);
      }
    })();
    return () => {
      current = false;
    };
  }, [userId, organizationId, showBanner]);
  return null;
}
