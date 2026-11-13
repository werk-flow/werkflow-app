'use client';

import { useState } from 'react';

import { Banner } from '@/components/ui/banner';
import { useHydrated } from '@/hooks/use-hydrated';
import { deviceMayHoldDrafts } from '@/lib/field-sync/device/draft-expiry';
import { deviceHoldsUnsentTime } from '@/lib/field-sync/device/unsent-mark';

// The catch-all of every session end (decision record 0010, the time outbox's invariant 5 and the
// amendment "a session end asks about report drafts"): every sign-out lands on an `(auth)` page, and
// unsent time events and report drafts stay on the phone past it. Whatever ordering left them
// there, the person sees it here before the next sign-in. It names only the kinds of work, no
// person, job, time or content: the phone may be shared. It reads the two static device marks, so
// the page loads no outbox or draft code for it; the work is sent once its person signs in again.

/** The kinds of unsent work the device marks say the phone holds, as the sentence names them. */
function heldKinds(): string | null {
  const time = deviceHoldsUnsentTime();
  const drafts = deviceMayHoldDrafts();
  if (time && drafts) return 'Zeiten und Berichtsentwürfe';
  if (time) return 'Zeiten';
  return drafts ? 'Berichtsentwürfe' : null;
}

export function UnsentWorkLandingNotice() {
  // Read in the browser only, after hydration: the server never knows what the phone holds.
  const kinds = useHydrated() ? heldKinds() : null;
  const [dismissed, setDismissed] = useState(false);
  if (kinds === null || dismissed) return null;
  return (
    <Banner
      banner={{
        id: 0,
        variant: 'info',
        message: `Auf diesem Gerät liegen noch nicht gesendete ${kinds}. Melde dich an, damit sie gesendet werden.`,
      }}
      onDismiss={() => setDismissed(true)}
    />
  );
}
