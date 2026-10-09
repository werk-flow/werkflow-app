import { cache, Suspense } from 'react';
import { redirect } from 'next/navigation';

import { MaintenanceContentSkeleton } from '@/components/loading-states/maintenance-page-skeleton';
import { MaintenanceContent, MaintenanceCreateButtons } from '@/components/service/maintenance-content';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { Skeleton } from '@/components/ui/skeleton';
import { getMaintenanceCatalogs, getMaintenanceWorkspace } from '@/lib/maintenance/actions';
import { parseMaintenanceWorkspaceQuery } from '@/lib/maintenance/workspace-page';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// One request-scoped read shared by the toolbar actions and the workspace, so
// the static toolbar paints before the data and the workspace still loads
// once. The cache keys on the query's primitive values.
const loadMaintenanceWorkspace = cache(
  (search: string, duePage: number, planPage: number, coveragePage: number) =>
    getMaintenanceWorkspace({ search, duePage, planPage, coveragePage }),
);

// The dialogs' small catalogs (published templates, follow-up owners), read
// once per request and never by the live refresh of the lists.
const loadMaintenanceCatalogs = cache(() => getMaintenanceCatalogs());

async function readWorkspace(searchParams: SearchParams) {
  const query = parseMaintenanceWorkspaceQuery(await searchParams);
  const result = await loadMaintenanceWorkspace(
    query.search,
    query.duePage,
    query.planPage,
    query.coveragePage,
  );
  return { query, result };
}

export default function MaintenancePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: SearchParams;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-lg font-semibold">Wartung</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Wiederkehrende Wartung pro Einsatzort planen, fällige Arbeit in Aufträge überführen und mit
            versionierten Nachweisen abschließen.
          </p>
        </div>
        <Suspense
          fallback={
            <div className="flex gap-2">
              <Skeleton className="h-9 w-44" />
              <Skeleton className="h-9 w-48" />
            </div>
          }
        >
          <MaintenanceActions searchParams={searchParams} />
        </Suspense>
      </div>
      <Suspense fallback={<MaintenanceContentSkeleton />}>
        <MaintenanceWorkspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function MaintenanceActions({ searchParams }: { searchParams: SearchParams }) {
  const [{ result }, catalogs] = await Promise.all([readWorkspace(searchParams), loadMaintenanceCatalogs()]);
  if (!result.success || !catalogs.success) return null;
  return <MaintenanceCreateButtons templates={catalogs.catalogs.templates} />;
}

async function MaintenanceWorkspace({ searchParams }: { searchParams: SearchParams }) {
  const [{ query, result }, catalogs] = await Promise.all([
    readWorkspace(searchParams),
    loadMaintenanceCatalogs(),
  ]);
  if (!result.success) {
    if (result.error === 'not_authorized') redirect('/auftraege');
    if (result.error === 'not_authenticated') redirect('/login');
    return (
      <RegionLoadError>
        {result.error === 'no_active_org'
          ? 'Es ist keine aktive Organisation ausgewählt.'
          : result.error === 'not_a_member'
            ? 'Du bist kein Mitglied der ausgewählten Organisation.'
            : 'Die Wartungsübersicht konnte nicht geladen werden.'}
      </RegionLoadError>
    );
  }
  if (!catalogs.success) {
    return <RegionLoadError>Die Wartungsübersicht konnte nicht geladen werden.</RegionLoadError>;
  }
  return <MaintenanceContent initial={result.workspace} catalogs={catalogs.catalogs} query={query} />;
}
