import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OrganizationProvider } from '@/components/organization/organization-context';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { AppShell } from '@/components/sidebar/app-shell';
import { ClockFAB } from '@/components/clock-fab';
import { ActiveJobsProvider } from '@/components/active-jobs-provider';
import { AppShellSkeleton } from '@/components/sidebar/app-shell-skeleton';
import {
  getCachedUser,
  getCachedMemberships,
  getCachedSubscriptionStatus,
  getCachedUserProfile,
} from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';

async function AppProviders({ children }: { children: React.ReactNode }) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) redirect('/login');

  const [memberships, isSubscribed, activeOrgId, profile] = await Promise.all([
    getCachedMemberships(user.id),
    getCachedSubscriptionStatus(user.id),
    resolveActiveOrgId(cookieStore, user.id),
    getCachedUserProfile(user.id, user.email!),
  ]);

  return (
    <OrganizationProvider
      initialMemberships={memberships}
      initialActiveOrgId={activeOrgId}
      initialIsSubscribed={isSubscribed}
    >
      <RealtimeProvider>
        <UserProfileProvider initialProfile={profile}>
          <ActiveJobsProvider>
            <AppShell>{children}</AppShell>
            <ClockFAB />
          </ActiveJobsProvider>
        </UserProfileProvider>
      </RealtimeProvider>
    </OrganizationProvider>
  );
}

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AppProviders>{children}</AppProviders>
    </Suspense>
  );
}
