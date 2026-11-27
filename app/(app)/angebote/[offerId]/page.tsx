import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { OfferContentEditor } from '@/components/angebote/editor/offer-content-editor';
import { EditOfferHeaderButton } from '@/components/angebote/offer-header-dialog';
import { OfferHeaderFacts } from '@/components/angebote/offer-header-facts';
import { StartOfferRevisionButton } from '@/components/angebote/offer-revision-start';
import { OfferRevisions } from '@/components/angebote/offer-revisions';
import { OfferSendActions } from '@/components/angebote/offer-sending';
import { OfferUnsavedProvider } from '@/components/angebote/offer-unsaved';
import { OfferStatusBadge } from '@/components/angebote/offers-list';
import { OfferDetailSkeleton } from '@/components/angebote/offers-skeleton';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { RouteRedirect } from '@/components/shared/route-redirect';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { logError } from '@/lib/logging';
import { getManagerAssigneeOptions } from '@/lib/members/profile-name';
import { readOfferRevisions, readOfferWithCosts } from '@/lib/offers/reads';
import type { OfferRevision, OfferWithCosts } from '@/lib/offers/types';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';

/** One offer on its own route, so two offers open in two tabs. */
export default async function OfferPage({ params }: { params: Promise<{ offerId: string }> }) {
  const { membership } = await resolvePageMembership();
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');
  const offerId = uuidSchema.safeParse((await params).offerId);
  const offer = !offerId.success
    ? null
    : await readOfferWithCosts(membership.orgId, offerId.data).catch((error: unknown) => {
        logError('angebot.read_failed', error);
        return 'failed' as const;
      });
  // Only a draft's header changes; its picker offers the office's members as responsible.
  const owners =
    offer && offer !== 'failed' && offer.status === 'entwurf'
      ? await getManagerAssigneeOptions(createSupabaseAdminClient(), membership.orgId)
      : null;
  const revisions =
    offer && offer !== 'failed'
      ? await readOfferRevisions(membership.orgId, offer.id).catch((error: unknown) => {
          logError('angebot.revisions_read_failed', error);
          return 'failed' as const;
        })
      : [];
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
    <OfferUnsavedProvider>
      <div className="space-y-6">
        <OfferPageHeader offer={offer} owners={owners} revisions={revisions} />
        {owners && !owners.success && (
          // The offer stays on screen; only its editing waits for the office's members.
          <RegionLoadError title="Bearbeiten ist gerade nicht möglich">
            Die Personen des Büros konnten nicht geladen werden. Versuche es in einem Moment erneut.
          </RegionLoadError>
        )}
        <OfferHeaderFacts offer={offer} />
        {revisions === 'failed' ? (
          <RegionLoadError title="Die gesendeten Revisionen konnten nicht geladen werden">
            Versuche es in einem Moment erneut.
          </RegionLoadError>
        ) : (
          <OfferRevisions revisions={revisions} editing={offer.status === 'entwurf'} />
        )}
        {/* Only a draft's content changes; a sent offer is edited as the draft of its next revision. */}
        {offer.status === 'entwurf' && <OfferContentEditor key={offer.id} offer={offer} />}
      </div>
    </OfferUnsavedProvider>
  );
}

/**
 * The way back, the title, the number with the revision the page shows and
 * the actions of the offer's state. The revision stays out while its read failed.
 */
function OfferPageHeader({
  offer,
  owners,
  revisions,
}: {
  offer: OfferWithCosts;
  owners: Awaited<ReturnType<typeof getManagerAssigneeOptions>> | null;
  revisions: OfferRevision[] | 'failed';
}) {
  // The newest sent revision; a draft after one is the next revision.
  const sentRevision = revisions === 'failed' ? null : (revisions[0]?.revision ?? 0);
  const shownRevision =
    sentRevision === null ? null : offer.status === 'entwurf' ? sentRevision + 1 : sentRevision;
  return (
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
          <span className="wrap-anywhere">
            {`${offer.offerNumber}${shownRevision ? `, Revision ${shownRevision}` : ''} · für ${offer.client.name}`}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OfferStatusBadge status={offer.status} validUntil={offer.validUntil} />
            {owners?.success && <EditOfferHeaderButton offer={offer} owners={owners.options} />}
            {offer.status === 'entwurf' && <OfferSendActions offer={offer} />}
            {offer.status === 'gesendet' && sentRevision ? (
              <StartOfferRevisionButton offer={offer} sentRevision={sentRevision} />
            ) : null}
          </div>
        }
      />
    </div>
  );
}
