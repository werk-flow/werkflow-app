import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CreditCard, Check } from 'lucide-react';

import { getCachedUser } from '@/lib/data/cached';
import { isUserSubscribed, userHasOrganizations } from '@/lib/subscription/helpers';
import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

import { SimulatePaymentButton } from './simulate-payment-button';

export const metadata: Metadata = {
  title: 'Upgrade - WerkFlow',
};

export default async function UpgradePage() {
  // An unavailable Auth service or a failed subscription read throws into
  // app/error.tsx with its retry: the offer is shown only to a caller whose
  // subscription was read and is not active.
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) {
    redirect('/login');
  }

  // If user already has organizations, redirect to dashboard
  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  // Read per request: an entitlement is never cached across requests.
  const subscribed = await isUserSubscribed(user.id);
  if (subscribed) {
    redirect('/onboarding/create-organization');
  }

  return (
    <StandaloneScreen>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <StandaloneTitle>WerkFlow Pro</StandaloneTitle>
          <p className="text-muted-foreground">Erstelle deine Organisation und starte durch</p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
              <CreditCard className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold">Pro Plan</h2>
            <CardDescription>Alles was du brauchst, um dein Team zu verwalten</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="space-y-3">
              {[
                'Unbegrenzte Organisationen',
                'Unbegrenzte Mitarbeiter',
                'Vollständige Admin-Kontrolle',
                'E-Mail-Einladungen',
                'Prioritäts-Support',
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-3">
                  <Check className="size-4 text-success-text" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="rounded-lg bg-muted p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">Entwicklungsmodus</p>
              <p className="text-sm">Klicke unten, um die Zahlung zu simulieren</p>
            </div>

            <SimulatePaymentButton />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Dies ist eine Entwicklungsumgebung. Keine echte Zahlung erforderlich.
        </p>
      </div>
    </StandaloneScreen>
  );
}
