import { RegionLoadError } from '@/components/shared/region-load-error';
import { SubpageHeader } from '@/components/shared/subpage-header';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { EquipmentListSkeleton } from '@/components/loading-states/equipment-page-skeleton';
import { EquipmentCreateButton, EquipmentListContent } from '@/components/service/equipment-list-content';
import { getInstalledEquipmentPage } from '@/lib/installed-equipment/list-page-server';
import { parseEquipmentListQuery } from '@/lib/installed-equipment/list-page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function InstalledEquipmentPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: SearchParams;
}) {
  return (
    <div className="space-y-6">
      <SubpageHeader
        title="Anlagen & Geräte"
        description="Installierte Anlagen an Kundeneinsatzorten mit Kennungen, Dokumenten und Servicehistorie."
        actions={<EquipmentCreateButton />}
      />
      <Suspense fallback={<EquipmentListSkeleton />}>
        <EquipmentList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function EquipmentList({ searchParams }: { searchParams: SearchParams }) {
  const query = parseEquipmentListQuery(await searchParams);
  const result = await getInstalledEquipmentPage(query);
  if (!result.success) {
    if (result.error === 'not_authorized') redirect('/auftraege');
    if (
      result.error === 'not_authenticated' ||
      result.error === 'no_active_org' ||
      result.error === 'not_a_member'
    ) {
      redirect('/login');
    }
    return (
      <RegionLoadError title="Anlagen und Geräte konnten nicht geladen werden">
        Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <EquipmentListContent initialPage={result.page} query={query} />;
}
