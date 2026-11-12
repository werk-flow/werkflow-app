import { Plus } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { LeistungenContent } from '@/components/angebote/leistungen/leistungen-content';
import { LeistungenListSkeleton } from '@/components/angebote/leistungen/leistungen-skeleton';
import { PageActionButton, PageActionProvider } from '@/components/shared/page-action';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { resolvePageMembership } from '@/lib/org/page-context';
import { parseLeistungListQuery } from '@/lib/price-catalog/list-page';
import { readLeistungPage } from '@/lib/price-catalog/reads';
import { isManagerRole } from '@/lib/roles';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function LeistungenData({
  organizationId,
  searchParams,
}: {
  organizationId: string;
  searchParams: SearchParams;
}) {
  const query = parseLeistungListQuery(await searchParams);
  const page = await readLeistungPage(organizationId, query, getBusinessTodayIso()).catch(
    (error: unknown) => {
      logError('angebote.leistungen.read_failed', error);
      return null;
    },
  );
  if (!page) {
    return (
      <RegionLoadError title="Leistungen konnten nicht geladen werden">
        Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <LeistungenContent {...page} query={query} />;
}

export default async function LeistungenPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: SearchParams;
}) {
  const { membership } = await resolvePageMembership();
  // Prices and cost rates are office facts: a field worker never opens this page.
  if (!membership || !isManagerRole(membership.role)) redirect('/dashboard');

  return (
    <PageActionProvider>
      <div className="space-y-6">
        <SubpageHeader
          title="Leistungen"
          description="Arbeitszeit, Anfahrt, Pauschalen, Gebühren und Fremdleistungen mit Preisen, die ab einem Tag gelten."
          actions={
            <PageActionButton>
              <Plus className="size-4" />
              Leistung anlegen
            </PageActionButton>
          }
        />
        <Suspense fallback={<LeistungenListSkeleton />}>
          <LeistungenData organizationId={membership.orgId} searchParams={searchParams} />
        </Suspense>
      </div>
    </PageActionProvider>
  );
}
