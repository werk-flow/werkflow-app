import { Suspense } from 'react';
import { cookies } from 'next/headers';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberCount } from '@/lib/data/cached';
import { SignOutButton } from '@/components/sign-out-button';
import { JoinedBanner } from '@/components/dashboard/joined-banner';
import { CreatedOrgBanner } from '@/components/dashboard/created-org-banner';
import { AlreadyMemberBanner } from '@/components/dashboard/already-member-banner';
import { OrgDeletedBanner } from '@/components/dashboard/org-deleted-banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';

export default async function DashboardPage() {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  const activeOrgId = user
    ? await resolveActiveOrgId(cookieStore, user.id)
    : null;

  const memberCount = activeOrgId
    ? await getCachedMemberCount(activeOrgId)
    : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4 sticky top-0 z-10 shrink-0">
        <h1 className="text-xl font-bold sm:text-2xl">Dashboard</h1>
        <SignOutButton />
      </header>

      <Suspense fallback={null}>
        <JoinedBanner />
      </Suspense>

      <Suspense fallback={null}>
        <CreatedOrgBanner />
      </Suspense>

      <Suspense fallback={null}>
        <AlreadyMemberBanner />
      </Suspense>

      <Suspense fallback={null}>
        <OrgDeletedBanner />
      </Suspense>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto max-w-2xl">
          <OrgInfoCard initialMemberCount={memberCount} />
        </div>
      </div>
    </div>
  );
}
