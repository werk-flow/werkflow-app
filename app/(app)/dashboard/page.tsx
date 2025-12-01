import { Suspense } from 'react';

import { SignOutButton } from '@/components/sign-out-button';
import { JoinedBanner } from '@/components/dashboard/joined-banner';
import { CreatedOrgBanner } from '@/components/dashboard/created-org-banner';
import { AlreadyMemberBanner } from '@/components/dashboard/already-member-banner';
import { OrgDeletedBanner } from '@/components/dashboard/org-deleted-banner';
import { OrgInfoCard } from '@/components/dashboard/org-info-card';

export default function DashboardPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-end border-b px-6 py-4">
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

      <div className="flex-1 p-6">
        <div className="mx-auto max-w-2xl">
          <OrgInfoCard />
        </div>
      </div>
    </div>
  );
}
