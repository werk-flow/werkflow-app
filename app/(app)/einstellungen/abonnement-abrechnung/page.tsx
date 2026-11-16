import { Suspense } from 'react';

import { BillingInvoicesCard } from '@/components/settings/billing/billing-invoices-card';
import { BillingNoSubscription } from '@/components/settings/billing/billing-no-subscription';
import { BillingOutlookCard } from '@/components/settings/billing/billing-outlook-card';
import { BillingSubscriptionCard } from '@/components/settings/billing/billing-subscription-card';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { BillingOutlookSkeleton } from '@/components/loading-states/einstellungen-page-skeleton';
import { readSettingsSectionMembership } from '@/lib/settings/section-access';
import { readWerkflowBilling } from '@/lib/werkflow-billing/billing-page';

// Only Admin opens this section; Büro and employees go to their profile
// (lib/settings/sections.ts). Each read and action checks the Admin again
// (werk-flow/werkflow-planning#252).
export default async function BillingSettingsPage() {
  const { membership } = await readSettingsSectionMembership('abonnement-abrechnung');
  const result = await readWerkflowBilling(membership.orgId);

  if (!result.success) {
    return (
      <RegionLoadError title="Abo und Rechnungen konnten nicht geladen werden">
        Deine Abrechnung ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  const { subscription, invoices } = result.billing;
  return (
    <div className="space-y-6">
      {subscription ? (
        <>
          <BillingSubscriptionCard organizationId={membership.orgId} subscription={subscription} />
          <Suspense fallback={<BillingOutlookSkeleton />}>
            <BillingOutlookCard organizationId={membership.orgId} />
          </Suspense>
        </>
      ) : (
        <BillingNoSubscription />
      )}
      {(subscription || invoices.length > 0) && (
        <BillingInvoicesCard organizationId={membership.orgId} invoices={invoices} />
      )}
    </div>
  );
}
