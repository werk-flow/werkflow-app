import { Suspense } from 'react';

import { OrganizationProvider } from '@/components/organization/organization-context';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { AppShell } from '@/components/sidebar/app-shell';
import { ClockFAB } from '@/components/clock-fab';
import { ActiveJobsProvider } from '@/components/active-jobs-provider';
import { AppShellSkeleton } from '@/components/sidebar/app-shell-skeleton';

export default function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <OrganizationProvider>
        <RealtimeProvider>
          <UserProfileProvider>
            <ActiveJobsProvider>
              <AppShell>{children}</AppShell>
              <ClockFAB />
            </ActiveJobsProvider>
          </UserProfileProvider>
        </RealtimeProvider>
      </OrganizationProvider>
    </Suspense>
  );
}
