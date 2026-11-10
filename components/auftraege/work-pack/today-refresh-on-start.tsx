'use client';

import { useEffect } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useBanner } from '@/components/ui/banner';
import { useUserProfile } from '@/components/user/user-profile-context';
import { todayWipeGeneration } from '@/lib/field-sync/device/today-wipe';
import { logError } from '@/lib/logging';

/**
 * Keeps the field worker's today snapshot on the phone current from app
 * start (decision record 0010, "Sync triggers"). Its code loads after the
 * page is usable, so the start page renders no byte of it. It renders nothing
 * itself; a day the device could not store shows as an error banner with a retry.
 * When the code itself cannot load (a chunk a deployment removed, a dropped
 * connection), the worker learns it before the signal goes, and the next
 * `online` tries the load once more.
 */
export function TodayRefreshOnStart(): null {
  const { showBanner } = useBanner();
  // From the app's client contexts, not props: every clock action re-renders the start page, and
  // props would add the ids to each of those responses. An organization switch changes the
  // context before the server renders the new start page, so the claim follows it at once.
  const { activeOrg } = useOrganization();
  const userId = useUserProfile().profile?.id ?? null;
  const organizationId = activeOrg?.role === 'employee' ? activeOrg.orgId : null;
  useEffect(() => {
    // No person or no field worker's organization yet: nothing to claim or refresh.
    if (!userId || !organizationId) return;
    let current = true;
    // Taken before the code loads: a sign-out that wipes meanwhile keeps this page from refreshing.
    const generationAtStart = todayWipeGeneration();
    let retried = false;
    const retryOnline = (): void => void start();
    const start = async (): Promise<void> => {
      try {
        const { keepTodayFresh } = await import('@/lib/field-sync/device/today-refresh');
        if (current)
          keepTodayFresh(
            { userId, organizationId },
            (retry) =>
              showBanner({
                variant: 'error',
                message:
                  'Deine Einsätze von heute konnten nicht auf dem Gerät gespeichert werden. Ohne Netz siehst du sie nicht.',
                actionLabel: 'Erneut versuchen',
                onAction: retry,
              }),
            generationAtStart,
          );
      } catch (error) {
        logError('TodayRefreshOnStart: refresh module failed to load', error);
        if (!current) return;
        showBanner({
          variant: 'error',
          message: 'Deine Einsätze von heute sind auf diesem Gerät nicht für offline gespeichert.',
          actionLabel: 'Für offline neu laden',
          onAction: () => window.location.reload(),
        });
        // One more load when the connection returns; the same wipe generation still guards it.
        if (!retried) window.addEventListener('online', retryOnline, { once: true });
        retried = true;
      }
    };
    void start();
    return () => {
      current = false;
      window.removeEventListener('online', retryOnline);
    };
  }, [userId, organizationId, showBanner]);
  return null;
}
