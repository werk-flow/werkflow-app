import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberCount } from '@/lib/data/cached';
import { UrlFlashBanner } from '@/components/ui/banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';
import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';

async function DashboardData({ activeOrgId }: { activeOrgId: string | null }) {
  const memberCount = activeOrgId ? await getCachedMemberCount(activeOrgId) : null;

  return <OrgInfoCard initialMemberCount={memberCount} />;
}

export default async function DashboardPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  return (
    <PageShell>
      <PageHeader title="Dashboard" />

      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="joined"
          messageTemplate="Du wurdest erfolgreich zu dieser Organisation hinzugefügt."
        />
      </Suspense>

      <Suspense fallback={null}>
        <UrlFlashBanner
          paramKey="created"
          messageTemplate="Organisation erstellt — Du bist jetzt Admin."
        />
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
