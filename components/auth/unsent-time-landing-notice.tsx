'use client';

import { useState } from 'react';

import { Banner } from '@/components/ui/banner';
import { useHydrated } from '@/hooks/use-hydrated';
import { deviceHoldsUnsentTime } from '@/lib/field-sync/device/unsent-mark';

// The catch-all of the time outbox (decision record 0010, the time outbox's invariant 5): every
// sign-out lands on an `(auth)` page, and unsent time events stay on the phone past it. Whatever
// ordering left them there, the person sees it here before the next sign-in, without opening the
// clock. It names nobody and no times: the phone may be shared. It reads only the static mark, so
// the page loads no outbox code; the events are sent once their person signs in again.

export function UnsentTimeLandingNotice() {
  // Read in the browser only, after hydration: the server never knows what the phone holds.
  const holds = useHydrated() && deviceHoldsUnsentTime();
  const [dismissed, setDismissed] = useState(false);
  if (!holds || dismissed) return null;
  return (
    <Banner
      banner={{
        id: 0,
        variant: 'info',
        message:
          'Auf diesem Gerät liegen noch nicht gesendete Zeiten. Melde dich an, damit sie gesendet werden.',
      }}
      onDismiss={() => setDismissed(true)}
    />
  );
}
