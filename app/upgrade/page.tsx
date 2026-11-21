import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { CreditCard, Check } from 'lucide-react';

import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { resolveActionContext } from '@/lib/org/action-context';
import {
  readOpenReservation,
  readOrganizationSubscription,
  userHasOrganizations,
} from '@/lib/subscription/helpers';
import { StandaloneScreen, StandaloneTitle } from '@/components/shared/standalone-screen';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

import { SubscribeButton } from './subscribe-button';

export const metadata: Metadata = {
  title: 'Abo abschließen - WerkFlow',
};

/** The organization this page subscribes, or null for a new one; redirects whoever has nothing to pay. */
async function subscriptionTarget(userId: string): Promise<{ id: string; name: string } | null> {
  if (!(await userHasOrganizations(userId))) {
    const reservation = await readOpenReservation(userId);
    if (reservation?.holdsSubscription) redirect('/onboarding/create-organization');
    return null;
  }
  // An existing organization without a subscription: only its Admin starts one.
  const caller = await resolveActionContext();
  if (!caller.success) {
    // Both codes name an absence (no session, no current membership); a failed read throws into app/error.tsx.
    if (caller.error === 'not_authenticated' || caller.error === 'no_active_org') redirect('/dashboard');
    throw new Error(caller.error);
  }
  if (caller.context.role !== 'admin') redirect('/dashboard');
  const { orgId } = caller.context;
  if ((await readOrganizationSubscription(orgId))?.holdsSubscription) redirect('/dashboard');
  const membership = (await getCachedMemberships(caller.context.userId)).find(
    (entry) => entry.orgId === orgId,
  );
  return { id: orgId, name: membership?.name ?? '' };
}

export default async function UpgradePage() {
  // An unavailable Auth service or a failed subscription read throws into
  // app/error.tsx with its retry: the offer is shown only to a caller whose
  // subscription was read and does not hold. Read per request: an entitlement
  // is never cached across requests.
  const {
    data: { user },
  } = await getCachedUser();

  if (!user) {
    redirect('/login');
  }

  const organization = await subscriptionTarget(user.id);

  return (
    <StandaloneScreen>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <StandaloneTitle>WerkFlow abonnieren</StandaloneTitle>
          <p className="text-muted-foreground">
            {organization
              ? `Das monatliche Abo für ${organization.name}`
              : 'Schließ das Abo ab, danach legst du deine Organisation an.'}
          </p>
        </div>

        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
              <CreditCard className="size-6 text-muted-foreground" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold">Monatliches Abo</h2>
            <CardDescription>Du zahlst sicher über Stripe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <ul className="space-y-3">
              {['Per SEPA-Lastschrift oder Karte', 'Den Preis siehst du vor dem Abschluss'].map((fact) => (
                <li key={fact} className="flex items-center gap-3">
                  <Check className="size-4 text-success-text" aria-hidden="true" />
                  <span className="text-sm">{fact}</span>
                </li>
              ))}
            </ul>

            <SubscribeButton {...(organization ? { organizationId: organization.id } : {})} />
          </CardContent>
        </Card>
      </div>
    </StandaloneScreen>
  );
}
