'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useBanner } from '@/components/ui/banner';
import { createChangeSettlement } from '@/lib/ui/change-settlement';

/**
 * The settle read for a surface whose authority arrives as refreshed server
 * props (a `router.refresh()` landing) rather than a `useLiveView` read.
 * `waitForChange()` resolves the next time `value` changes identity, so a
 * dialog edit can keep the changed row marked as settling
 * (`useServerAction`'s `isSettling`, `useBusyIds`) until the authoritative
 * row is on screen. A timeout ends the indicator and reports the unconfirmed
 * refresh through the shared banner. Unmount cancellation stays quiet.
 */
export function useSettleOnChange(value: unknown, timeoutMs = 15_000): () => Promise<void> {
  const { showBanner } = useBanner();
  const settlementRef = useRef(createChangeSettlement());
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    settlementRef.current.changed();
  }, [value]);

  useEffect(() => {
    const settlement = settlementRef.current;
    return () => settlement.cancel();
  }, []);

  return useCallback(
    async () => {
      const outcome = await settlementRef.current.wait(timeoutMs);
      if (outcome === 'timed-out') {
        showBanner({ variant: 'error', message: 'Die Änderung wurde gespeichert, die Ansicht aber noch nicht aktualisiert. Bitte aktualisiere die Seite.' });
      }
    },
    [timeoutMs, showBanner]
  );
}
