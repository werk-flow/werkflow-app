import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Info } from 'lucide-react';

import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { readOpenReservation, userHasOrganizations } from '@/lib/subscription/helpers';
import { FurtherOrganizationCheckoutButton } from '@/components/organization/further-organization-checkout';
import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Zahlung abgebrochen - WerkFlow',
};

// Where a cancelled Checkout of a reservation returns (werk-flow/werkflow-planning#500).
// It takes nothing from the query string: the caller's own records decide.
// A payer without an organization goes back to /upgrade, which offers the
// first organization's Checkout. An Admin who cancelled a further
// organization's Checkout sees that nothing was charged and starts it again
// here, never the active organization's own subscription.

/** An organization the caller administers, to pay the further one from; redirects whoever has none. */
async function furtherOrganizationPayer(userId: string): Promise<string> {
  if (!(await userHasOrganizations(userId))) redirect('/upgrade');
  const reservation = await readOpenReservation(userId);
  // Paid meanwhile, in another tab or before Stripe's back link: name it.
  if (reservation?.holdsSubscription) redirect('/onboarding/create-organization');
  const admin = (await getCachedMemberships(userId)).find((membership) => membership.role === 'admin');
  if (!reservation || !admin) redirect('/dashboard');
  return admin.orgId;
}

export default async function CheckoutCancelledPage() {
  // A failed read throws into app/error.tsx with its retry.
  const {
    data: { user },
  } = await getCachedUser();
  if (!user) redirect('/login');

  const adminOrganizationId = await furtherOrganizationPayer(user.id);

  return (
    <StandaloneScreen>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <StandaloneTitle>Neue Organisation erstellen</StandaloneTitle>
          <p className="text-muted-foreground">Jede Organisation hat ihr eigenes monatliches Abo.</p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
              <Info className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold">Zahlung abgebrochen</h2>
            <CardDescription>
              Es wurde nichts abgebucht und keine Organisation angelegt. Du kannst die Zahlung jederzeit
              erneut starten.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FurtherOrganizationCheckoutButton adminOrganizationId={adminOrganizationId} />
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard">Zurück zu WerkFlow</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </StandaloneScreen>
  );
}
