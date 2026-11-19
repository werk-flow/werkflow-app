import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

import { OfflineToday } from '@/components/auftraege/work-pack/offline-today';
import { OfflineClock } from '@/components/clock-offline';
import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { ReturnOnSignal } from './return-on-signal';
import { RetryButton } from './retry-button';

export const metadata: Metadata = {
  title: 'Kein Netz',
};

// The service worker (/sw.js) answers a navigation with this page when
// the network fails, under the address the person opened, so „Erneut
// versuchen“ reloads exactly that page, and so does the signal coming back
// (return-to-app.ts). It is prerendered and proxy.ts never
// runs on it, so it holds nothing about the person; the worker caches it only
// when the answer is not marked private or no-store. A field
// worker's phone shows today's assignments from its own storage instead
// (components/auftraege/work-pack/offline-today.tsx), and a phone that holds
// unsent clock events shows its clock above them (components/clock-offline.tsx).
export default function OfflinePage() {
  return (
    <StandaloneScreen>
      <ReturnOnSignal />
      <OfflineClock />
      <OfflineToday withoutDay={<NoSignal />} />
    </StandaloneScreen>
  );
}

function NoSignal() {
  return (
    <div className="mx-auto max-w-md text-center">
      <div className="mb-6 flex justify-center">
        <div className="rounded-full bg-muted p-4">
          <WifiOff className="size-12 text-muted-foreground" />
        </div>
      </div>
      <StandaloneTitle>Gerade kein Netz</StandaloneTitle>
      <p className="mt-2 mb-8 text-muted-foreground">
        Dein Gerät hat gerade keine Verbindung. Sobald du wieder Empfang hast, öffnet sich WerkFlow von
        selbst, oder du tippst auf „Erneut versuchen“.
      </p>
      <RetryButton />
    </div>
  );
}
