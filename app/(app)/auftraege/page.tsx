import { loadJobListPage } from '@/lib/jobs/list-server';
import { parseJobListQuery, type ListSearchParams } from '@/lib/jobs/list-page';
import { SectionError } from '@/components/ui/section-error';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getCachedMemberships,
  getCachedOrganizationUserPreferences,
  getCachedUser,
} from '@/lib/data/cached';
import { AuftraegeContent } from '@/components/auftraege/auftraege-content';
import { AuftraegeContentSkeleton } from '@/components/loading-states/auftraege-content-skeleton';
import { PageActionButton, PageActionProvider } from '@/components/shared/page-action';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { UrlFlashBanner } from '@/components/ui/banner';
import { type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';

async function AuftraegeData({ activeOrgId, userId, isAdminOrManager, initialVisibleColumns, searchParams }: {
  activeOrgId: string; userId: string; isAdminOrManager: boolean;
  initialVisibleColumns: import('@/lib/jobs/auftraege-table-columns').AuftraegeColumnId[];
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const queries = { active: parseJobListQuery(params, 'active', initialVisibleColumns), parked: parseJobListQuery(params, 'parked', initialVisibleColumns), archived: parseJobListQuery(params, 'archived', initialVisibleColumns) };
  const result = await Promise.all([loadJobListPage(queries), getOrgMembersForUser(activeOrgId, userId)]).catch(() => null);
  if (!result) return <SectionError>Aufträge konnten nicht geladen werden. Bitte aktualisiere die Seite.</SectionError>;
  const [data, members] = result;
  return <AuftraegeContent {...data} isAdminOrManager={isAdminOrManager} visibleColumns={initialVisibleColumns}
    members={members.map((member) => ({ userId: member.user_id, firstName: member.first_name, lastName: member.last_name, role: member.role }))} />;
}
export default async function AuftraegePage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<ListSearchParams> }) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id)
  ]);

  if (!activeOrgId) {
    return (
      <PageShell>
        <PageHeader title="Aufträge" />
        <PageBody>
          <p className="text-muted-foreground">
            Bitte wähle zuerst eine Organisation aus.
          </p>
        </PageBody>
      </PageShell>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const currentUserRole = currentMembership?.role as OrgRole | undefined;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';
  const { visibleColumns } = await getCachedOrganizationUserPreferences(
    activeOrgId,
    user.id
  );

  // The header and its create action paint before the list data; the create
  // dialog itself lives in AuftraegeContent because it needs the loaded lists,
  // and PageActionProvider shares the open flag across that boundary.
  return (
    <PageActionProvider>
      <PageShell>
        <Suspense fallback={null}>
          <UrlFlashBanner
            paramKey="deleted_job"
            messageTemplate='Auftrag „{name}" wurde erfolgreich gelöscht.'
          />
        </Suspense>
        <Suspense fallback={null}>
          <UrlFlashBanner
            paramKey="deleted_project"
            messageTemplate='Projekt „{name}" wurde erfolgreich gelöscht.'
          />
        </Suspense>
        <PageHeader
          title="Aufträge"
          actions={
            isAdminOrManager ? (
              <PageActionButton className="gap-2">
                <Plus className="size-4" />
                <span className="hidden sm:inline">Erstellen</span>
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
              initialVisibleColumns={visibleColumns} searchParams={searchParams}
            />
          </Suspense>
        </PageBody>
      </PageShell>
    </PageActionProvider>
  );
}
