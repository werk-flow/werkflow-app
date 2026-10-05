import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { ServiceCaseListSkeleton } from '@/components/loading-states/service-cases-page-skeleton';
import {
  ServiceCaseCreateButton,
  ServiceCaseListContent,
} from '@/components/service/service-case-list-content';
import { getServiceCasePage } from '@/lib/service-cases/list-page-server';
import { parseServiceCaseListQuery } from '@/lib/service-cases/list-page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function ServiceCasesPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: SearchParams;
}) {
  return (
    <div className="space-y-6">
      <SubpageHeader
        title="Servicefälle"
        description="Störungen, Reparaturen und vermutete Gewährleistungsfälle vom Eingang bis zur Nacharbeit."
        actions={<ServiceCaseCreateButton />}
      />
      <Suspense fallback={<ServiceCaseListSkeleton />}>
        <ServiceCaseList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ServiceCaseList({ searchParams }: { searchParams: SearchParams }) {
  const query = parseServiceCaseListQuery(await searchParams);
  const result = await getServiceCasePage(query);
  if (!result.success) {
    if (result.error === 'not_authorized') redirect('/auftraege');
    if (['not_authenticated', 'no_active_org', 'not_a_member'].includes(result.error)) redirect('/login');
    return (
      <RegionLoadError title="Servicefälle konnten nicht geladen werden">
        Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <ServiceCaseListContent initialPage={result.page} query={query} />;
}
