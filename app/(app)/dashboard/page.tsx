import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberCount } from '@/lib/data/cached';
import { UrlFlashBanner } from '@/components/ui/banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';
import { DashboardContentSkeleton } from '@/components/loading-states/dashboard-content-skeleton';

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
    <div className="flex flex-col h-full overflow-hidden">
      <header className="sticky top-0 z-10 flex items-center border-b bg-background px-4 py-3 sm:px-6 sm:py-4 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
      </header>

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

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Suspense fallback={<DashboardContentSkeleton />}>
          <DashboardData activeOrgId={activeOrgId} />
        </Suspense>
      </div>
    </div>
  );
}
