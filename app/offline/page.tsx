import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { RetryButton } from './retry-button';

export const metadata: Metadata = {
  title: 'Kein Netz',
};

// The service worker (public/sw.js) answers a navigation with this page when
// the network fails, under the address the person opened, so „Erneut
// versuchen“ reloads exactly that page. It is prerendered and the worker
// fetches it without cookies: it holds nothing about the person.
export default function OfflinePage() {
  return (
    <StandaloneScreen>
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-muted p-4">
            <WifiOff className="size-12 text-muted-foreground" />
          </div>
        </div>
        <StandaloneTitle>Gerade kein Netz</StandaloneTitle>
        <p className="mt-2 mb-8 text-muted-foreground">
          Dein Gerät hat gerade keine Verbindung. Ohne Netz kannst du WerkFlow noch nicht nutzen. Sobald du
          wieder Empfang hast, tippe auf „Erneut versuchen“.
        </p>
        <RetryButton />
      </div>
    </StandaloneScreen>
  );
}
