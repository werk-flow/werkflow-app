import type { Metadata } from 'next';
import Link from 'next/link';
import { CloudOff } from 'lucide-react';

import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Anmeldung nicht erreichbar',
};

// The auth callback sends a person here when Auth could not answer their
// link. The link may still be valid, so the page asks for a retry and names
// no invalid link. The page is prerendered, so it answers 200: under
// cacheComponents a page serves its build-time status.
export default function AuthUnavailablePage() {
  return (
    <StandaloneScreen>
      <div className="mx-auto max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <CloudOff className="size-12 text-destructive" />
          </div>
        </div>
        <StandaloneTitle>Anmeldung gerade nicht erreichbar</StandaloneTitle>
        <p className="mt-2 mb-8 text-muted-foreground">
          Dein Link ist wahrscheinlich noch gültig, aber die Anmeldung antwortet gerade nicht. Warte einen
          Moment und öffne den Link aus deiner E-Mail dann erneut.
        </p>
        <Button asChild>
          <Link href="/login">Zur Anmeldung</Link>
        </Button>
      </div>
    </StandaloneScreen>
  );
}
