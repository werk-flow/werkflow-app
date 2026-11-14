import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OfferHeaderEditor } from '@/components/angebote/offer-header-form';
import { OfferStatusBadge } from '@/components/angebote/offers-list';
import { OfferDetailSkeleton } from '@/components/angebote/offers-skeleton';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { logError } from '@/lib/logging';
import { getManagerAssigneeOptions } from '@/lib/members/profile-name';
import { readOffer } from '@/lib/offers/reads';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';

/** One offer on its own route, so two offers open in two tabs. */
export default async function OfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { membership } = await resolvePageMembership();
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');
  const offerId = uuidSchema.safeParse((await params).offerId);
  if (!offerId.success) redirect('/angebote');

  const [offer, owners] = await Promise.all([
    readOffer(membership.orgId, offerId.data).catch((error: unknown) => {
      logError('angebot.read_failed', error);
      return 'failed' as const;
    }),
    getManagerAssigneeOptions(createSupabaseAdminClient(), membership.orgId),
  ]);
  if (offer === 'failed' || !owners.success) {
    return (
      <RegionLoadError title="Das Angebot konnte nicht geladen werden">
        Das Angebot ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  // Another organization's offer, or one that is gone: back to the list.
  if (!offer) {
    return (
      <RouteRedirect href="/angebote">
        <OfferDetailSkeleton />
      </RouteRedirect>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/angebote"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ArrowLeft className="size-4" />
          Alle Angebote
        </Link>
        <SubpageHeader
          title={offer.title}
          description={`${offer.offerNumber} · für ${offer.client.name}`}
          actions={<OfferStatusBadge status={offer.status} />}
        />
      </div>
      {offer.status === 'entwurf' ? (
        <OfferHeaderEditor offer={offer} owners={owners.options} />
      ) : (
        <p className="text-sm text-muted-foreground">Das Angebot ist kein Entwurf mehr und lässt sich nicht ändern.</p>
      )}
    </div>
  );
}
