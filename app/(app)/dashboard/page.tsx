import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberCount, getCachedMemberships } from '@/lib/data/cached';
import { TodayRefreshOnStart } from '@/components/auftraege/work-pack/today-refresh-on-start';
import { UrlFlashBanner } from '@/components/ui/banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';
import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton';
import { OnCallNowSkeleton } from '@/components/loading-states/on-call-skeletons';
import { OnCallNowCard } from '@/components/on-call/on-call-now-card';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { readOnCallOverview } from '@/lib/on-call/reads';
import type { UserOrg } from '@/lib/org/types';
import { isManagerRole } from '@/lib/roles';

async function DashboardData({ activeOrgId }: { activeOrgId: string | null }) {
  if (!activeOrgId) return <OrgInfoCard initialMemberCount={null} />;
  // The reader logged a failure and cached nothing; the card shows the failure with a retry.
  const memberCount = await getCachedMemberCount(activeOrgId).catch(() => null);

  return <OrgInfoCard initialMemberCount={memberCount} />;
}

// „Bereitschaft jetzt“ for every role of the active organization
// (werk-flow/werkflow-planning#469); the membership read established it.
async function OnCallNowRegion({ membership, userId }: { membership: UserOrg; userId: string }) {
  const result = await readOnCallOverview(membership.orgId, userId);
  if (!result.success) {
    return (
      <RegionLoadError title="Die Bereitschaft konnte nicht geladen werden">
        Wer gerade Bereitschaft hat, ist gerade nicht abrufbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  return <OnCallNowCard overview={result.overview} canPlan={isManagerRole(membership.role)} />;
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
  // Only the gate is rendered here; the refresh takes person and organization from the client contexts.
  const activeMembership = memberships.find((entry) => entry.orgId === activeOrgId) ?? null;
  const keepsToday = activeMembership?.role === 'employee';

  return (
    <PageShell>
      {keepsToday && <TodayRefreshOnStart />}
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

      <PageBody className="space-y-4">
        {activeMembership && (
          <Suspense fallback={<OnCallNowSkeleton />}>
            <OnCallNowRegion membership={activeMembership} userId={user.id} />
          </Suspense>
        )}
        <Suspense fallback={<DashboardContentSkeleton />}>
          <DashboardData activeOrgId={activeOrgId} />
        </Suspense>
      </PageBody>
    </PageShell>
  );
}
