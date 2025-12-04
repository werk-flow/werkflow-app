import { Suspense } from 'react';
import { cookies } from 'next/headers';

import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getCachedMemberCount } from '@/lib/data/cached';
import { SignOutButton } from '@/components/sign-out-button';
import { JoinedBanner } from '@/components/dashboard/joined-banner';
import { CreatedOrgBanner } from '@/components/dashboard/created-org-banner';
import { AlreadyMemberBanner } from '@/components/dashboard/already-member-banner';
import { OrgDeletedBanner } from '@/components/dashboard/org-deleted-banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

  // Fetch member count server-side using cached function
  const memberCount = activeOrgId ? await getCachedMemberCount(activeOrgId) : null;

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
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

      <div className="flex-1 p-4 sm:p-6">
        <div className="mx-auto max-w-2xl">
          <OrgInfoCard initialMemberCount={memberCount} />
        </div>
      </div>
    </div>
  );
}
