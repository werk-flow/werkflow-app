'use client';

import { useEffect, useRef, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { useBanner } from '@/components/ui/banner';
import { useUserProfile } from '@/components/user/user-profile-context';
import { TODAY_WIPE_KEY, todayWipeGeneration } from '@/lib/field-sync/device/today-wipe';
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
  const { activeOrg, isSwitchingOrg } = useOrganization();
  const userId = useUserProfile().profile?.id ?? null;
  const organizationId = activeOrg?.role === 'employee' ? activeOrg.orgId : null;
  // The wipe generation this page may claim under. Taken when the page first renders, so a
  // sign-out that wipes meanwhile keeps it from claiming: also when the person's id arrives only
  // later (a profile the browser reads itself), and when a membership fallback changes the
  // organization. Only an explicit switch in this tab renews it, to the generation of the switch's
  // own wipe: `setActiveOrg` wipes synchronously before this page renders `isSwitchingOrg`, so
  // that render reads it. A wipe after it, such as another tab's sign-out while the switch waits
  // for its cookie, still blocks the claim until the next start page.
  const [claim, setClaim] = useState<{
    organizationId: string | null;
    generation: string;
    switchGeneration: string | null;
  }>(() => ({ organizationId, generation: todayWipeGeneration(), switchGeneration: null }));
  const switchGeneration = isSwitchingOrg ? (claim.switchGeneration ?? todayWipeGeneration()) : null;
  if (claim.organizationId !== organizationId || claim.switchGeneration !== switchGeneration)
    setClaim({
      organizationId,
      generation:
        claim.organizationId !== organizationId && switchGeneration !== null
          ? switchGeneration
          : claim.generation,
      switchGeneration,
    });
  // Another tab wiped the device: its `storage` event never fires for this tab's own writes. A
  // switch may have read that wipe's generation as its own, so this page claims nothing more until
  // the next start page, and a claim it already made is dropped.
  const [foreignWipe, setForeignWipe] = useState(false);
  const refreshModule = useRef<typeof import('@/lib/field-sync/device/today-refresh') | null>(null);
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== TODAY_WIPE_KEY) return;
      setForeignWipe(true);
      refreshModule.current?.dropTodayClaim();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  // No wipe generation reads `blocked`, so `keepTodayFresh` refuses it.
  const generationAtStart = foreignWipe ? 'blocked' : claim.generation;
  useEffect(() => {
    // No person or no field worker's organization yet: nothing to claim or refresh.
    if (!userId || !organizationId) return;
    let current = true;
    let retried = false;
    const retryOnline = (): void => void start();
    const start = async (): Promise<void> => {
      try {
        const refresh = await import('@/lib/field-sync/device/today-refresh');
        refreshModule.current = refresh;
        if (current)
          refresh.keepTodayFresh(
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
  }, [userId, organizationId, generationAtStart, showBanner]);
  return null;
}
