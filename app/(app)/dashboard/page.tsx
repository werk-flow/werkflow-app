import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberCount, getCachedMemberships } from '@/lib/data/cached';
import { TodayRefreshOnStart } from '@/components/auftraege/work-pack/today-refresh-on-start';
import { UrlFlashBanner } from '@/components/ui/banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';
import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

async function DashboardData({ activeOrgId }: { activeOrgId: string | null }) {
  if (!activeOrgId) return <OrgInfoCard initialMemberCount={null} />;
  // The reader logged a failure and cached nothing; the card shows the failure with a retry.
  const memberCount = await getCachedMemberCount(activeOrgId).catch(() => null);

  return <OrgInfoCard initialMemberCount={memberCount} />;
}

export default async function DashboardPage() {
  const [
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([getCachedUser(), cookies()]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);
  // The start page of every role: a field worker's phone refreshes the day it keeps for signal loss here.
  const keepsToday = memberships.some((entry) => entry.orgId === activeOrgId && entry.role === 'employee');

  return (
    <PageShell>
      {keepsToday && activeOrgId && <TodayRefreshOnStart userId={user.id} organizationId={activeOrgId} />}
      <PageHeader title="Dashboard" />

      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="joined"
          messageTemplate="Du wurdest erfolgreich zu dieser Organisation hinzugefügt."
        />
      </Suspense>

      <Suspense fallback={null}>
        <UrlFlashBanner paramKey="created" messageTemplate="Organisation erstellt — Du bist jetzt Admin." />
      </Suspense>

      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="already_member"
          messageTemplate="Du bist bereits Teil dieser Organisation."
          variant="info"
        />
      </Suspense>

      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="org_deleted"
          messageTemplate="Die Organisation wurde erfolgreich gelöscht."
        />
      </Suspense>

      <PageBody>
        <Suspense fallback={<DashboardContentSkeleton />}>
          <DashboardData activeOrgId={activeOrgId} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
