import { loadJobListPage } from '@/lib/jobs/list-server';
import { parseJobListQuery, type ListSearchParams } from '@/lib/jobs/list-page';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { Suspense } from 'react';
import { Plus } from 'lucide-react';

import { resolvePageMembership } from '@/lib/org/page-context';
import { getOrganizationUserPreferencesForView } from '@/lib/data/cached';
import { isManagerRole } from '@/lib/roles';
import { AuftraegeContent } from '@/components/auftraege/list/auftraege-content';
import { AuftraegeContentSkeleton } from '@/components/loading-states/auftraege-content-skeleton';
import { PageActionButton, PageActionProvider } from '@/components/shared/page-action';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UrlFlashBanner } from '@/components/ui/banner';
import { getOrgMembersForUser } from '@/lib/members/queries';

async function AuftraegeData({
  activeOrgId,
  userId,
  isAdminOrManager,
  initialVisibleColumns,
  searchParams,
}: {
  activeOrgId: string;
  userId: string;
  isAdminOrManager: boolean;
  initialVisibleColumns: import('@/lib/jobs/auftraege-table-columns').AuftraegeColumnId[];
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const queries = {
    active: parseJobListQuery(params, 'active', initialVisibleColumns),
    parked: parseJobListQuery(params, 'parked', initialVisibleColumns),
    archived: parseJobListQuery(params, 'archived', initialVisibleColumns),
  };
  const result = await Promise.all([
    loadJobListPage(queries),
    getOrgMembersForUser(activeOrgId, userId),
  ]).catch(() => null);
  if (!result || !result[1].success)
    return (
      <RegionLoadError title="Aufträge konnten nicht geladen werden">
        Die Liste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  const [data, membersRead] = result;
  return (
    <AuftraegeContent
      {...data}
      isAdminOrManager={isAdminOrManager}
      visibleColumns={initialVisibleColumns}
      members={membersRead.members.map((member) => ({
        userId: member.user_id,
        firstName: member.first_name,
        lastName: member.last_name,
        role: member.role,
      }))}
    />
  );
}
export default async function AuftraegePage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<ListSearchParams>;
}) {
  const { user, membership } = await resolvePageMembership();

  if (!membership) {
    return (
      <PageShell>
        <PageHeader title="Aufträge" />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }

  const activeOrgId = membership.orgId;
  const isAdminOrManager = isManagerRole(membership.role);
  const { visibleColumns } = await getOrganizationUserPreferencesForView(activeOrgId, user.id);

  // The header and its create action paint before the list data; the create
  // dialog itself lives in AuftraegeContent because it needs the loaded lists,
  // and PageActionProvider shares the open flag across that boundary.
  return (
    <PageActionProvider>
      <PageShell>
        <Suspense fallback={null}>
          <UrlFlashBanner
            paramKey="deleted_job"
            messageTemplate="Auftrag „{name}“ wurde erfolgreich gelöscht."
          />
        </Suspense>
        <Suspense fallback={null}>
          <UrlFlashBanner
            paramKey="deleted_project"
            messageTemplate="Projekt „{name}“ wurde erfolgreich gelöscht."
          />
        </Suspense>
        <PageHeader
          title="Aufträge"
          actions={
            isAdminOrManager ? (
              <PageActionButton className="gap-2">
                <Plus className="size-4" />
                <span className="sr-only sm:not-sr-only">Erstellen</span>
              </PageActionButton>
            ) : undefined
          }
        />

        <PageBody>
          <Suspense fallback={<AuftraegeContentSkeleton />}>
            <AuftraegeData
              activeOrgId={activeOrgId}
              userId={user.id}
              isAdminOrManager={isAdminOrManager}
              initialVisibleColumns={visibleColumns}
              searchParams={searchParams}
            />
          </Suspense>
        </PageBody>
      </PageShell>
    </PageActionProvider>
  );
}
