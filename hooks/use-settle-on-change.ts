'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useBanner } from '@/components/ui/banner';
import { createChangeSettlement } from '@/lib/ui/change-settlement';

/** Waits for the next change of the watched value, or for one after `since` (`markChange`). */
export type SettleOnChange = ((since?: number) => Promise<void>) & { markChange: () => number };

/**
 * The settle read for a surface whose authority arrives as refreshed server
 * props rather than a `useLiveView` read: the render that a revalidating
 * Server Action carries in its response, or a `router.refresh()` landing.
 * `waitForChange()` resolves the next time `value` changes identity, so a
 * dialog edit can keep the changed row marked as settling
 * (`useServerAction`'s `isSettling`, `useBusyIds`) until the authoritative
 * row is on screen. A save of several actions takes `markChange()` before the
 * first and waits from it, since an earlier action's render can land before
 * the wait starts. A timeout ends the indicator and reports the unconfirmed
 * refresh through the shared banner. Unmount cancellation stays quiet.
 */
export function useSettleOnChange(value: unknown, timeoutMs = 15_000): SettleOnChange {
  const { showBanner } = useBanner();
  const [settlement] = useState(createChangeSettlement);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    settlement.changed();
  }, [value, settlement]);

  useEffect(() => () => settlement.cancel(), [settlement]);

  return useMemo(() => {
    const waitForChange = async (since?: number): Promise<void> => {
      const outcome = await settlement.wait(timeoutMs, since);
      if (outcome === 'timed-out') {
        showBanner({
          variant: 'error',
          message:
            'Die Änderung wurde gespeichert, die Ansicht aber noch nicht aktualisiert. Bitte aktualisiere die Seite.',
        });
      }
    };
    return Object.assign(waitForChange, { markChange: () => settlement.mark() });
  }, [settlement, timeoutMs, showBanner]);
}
