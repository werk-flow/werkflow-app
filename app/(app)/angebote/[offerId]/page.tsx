import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OfferHeaderFacts } from '@/components/angebote/offer-header-facts';
import { OfferStatusBadge } from '@/components/angebote/offers-list';
import { OfferDetailSkeleton } from '@/components/angebote/offers-skeleton';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { logError } from '@/lib/logging';
import { readOffer } from '@/lib/offers/reads';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation/uuid';

/** One offer on its own route, so two offers open in two tabs. */
export default async function OfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { membership } = await resolvePageMembership();
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');
  const offerId = uuidSchema.safeParse((await params).offerId);
  const offer = !offerId.success
    ? null
    : await readOffer(membership.orgId, offerId.data).catch((error: unknown) => {
        logError('angebot.read_failed', error);
        return 'failed' as const;
      });
  if (offer === 'failed') {
    return (
      <RegionLoadError title="Das Angebot konnte nicht geladen werden">
        Das Angebot ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  // No offer id, another organization's offer, or one that is gone: back to the list.
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
          // A title or customer name can hold a word wider than a phone.
          title={<span className="wrap-anywhere">{offer.title}</span>}
          description={
            <span className="wrap-anywhere">{`${offer.offerNumber} · für ${offer.client.name}`}</span>
          }
          actions={<OfferStatusBadge status={offer.status} />}
        />
      </div>
      <OfferHeaderFacts offer={offer} />
    </div>
  );
}
