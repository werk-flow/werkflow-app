import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CreditCard, Check } from 'lucide-react';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { userHasOrganizations, isUserSubscribed } from '@/lib/subscription/helpers';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';

import { SimulatePaymentButton } from './simulate-payment-button';

export const metadata: Metadata = {
  title: 'Upgrade - WerkFlow'
};

export default async function UpgradePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // If user already has organizations, redirect to dashboard
  const hasOrgs = await userHasOrganizations(user.id);
  if (hasOrgs) {
    redirect('/dashboard');
  }

  // If user is already subscribed, redirect to create organization
  const subscribed = await isUserSubscribed(user.id);
  if (subscribed) {
    redirect('/onboarding/create-organization');
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">
            WerkFlow Pro
          </h1>
          <p className="text-muted-foreground">
            Erstelle deine Organisation und starte durch
          </p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
              <CreditCard className="size-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Pro Plan</CardTitle>
            <CardDescription>
              Alles was du brauchst, um dein Team zu verwalten
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="space-y-3">
              {[
                'Unbegrenzte Organisationen',
                'Unbegrenzte Mitarbeiter',
                'Vollständige Admin-Kontrolle',
                'E-Mail-Einladungen',
                'Prioritäts-Support'
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-3">
                  <Check className="size-4 text-green-500" />
                  <span className="text-sm">{feature}</span>
                </li>
              ))}
            </ul>

            <div className="rounded-lg bg-muted p-4 text-center">
              <p className="text-xs text-muted-foreground mb-1">
                Entwicklungsmodus
              </p>
              <p className="text-sm">
                Klicke unten, um die Zahlung zu simulieren
              </p>
            </div>

            <SimulatePaymentButton />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Dies ist eine Entwicklungsumgebung. Keine echte Zahlung erforderlich.
        </p>
      </div>
    </div>
  );
}



