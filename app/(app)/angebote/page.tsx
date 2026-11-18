import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { OffersContent } from '@/components/angebote/offers-content';
import { OffersListSkeleton } from '@/components/angebote/offers-skeleton';
import { PageActionButton, PageActionProvider, PageActionUnavailable } from '@/components/shared/page-action';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { logError } from '@/lib/logging';
import { parseOfferListQuery } from '@/lib/offers/list-page';
import { readOfferPage } from '@/lib/offers/reads';
import { resolvePageMembership } from '@/lib/org/page-context';
import { isManagerRole } from '@/lib/roles';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function OffersData({
  organizationId,
  searchParams,
}: {
  organizationId: string;
  searchParams: SearchParams;
}) {
  const query = parseOfferListQuery(await searchParams);
  const page = await readOfferPage(organizationId, query).catch((error: unknown) => {
    logError('angebote.read_failed', error);
    return null;
  });
  if (!page) {
    // The create dialog lives in OffersContent, so „Angebot anlegen“ hides with it.
    return (
      <>
        <PageActionUnavailable />
        <RegionLoadError title="Angebote konnten nicht geladen werden">
          Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
        </RegionLoadError>
      </>
    );
  }
  return <OffersContent {...page} query={query} />;
}

export default async function OffersPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: SearchParams;
}) {
  const { membership } = await resolvePageMembership();
  // Offers are office records: a field worker never opens this page.
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');

  return (
    <PageActionProvider>
      <div className="space-y-6">
        <SubpageHeader
          title="Angebote"
          description="Jedes Angebot mit Kunde, Rechnungsempfänger und Gültigkeit."
          actions={
            <PageActionButton>
              <Plus className="size-4" />
              Angebot anlegen
            </PageActionButton>
          }
        />
        <Suspense fallback={<OffersListSkeleton />}>
          <OffersData organizationId={membership.orgId} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageActionProvider>
  );
}
