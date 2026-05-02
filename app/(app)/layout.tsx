import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OrganizationProvider } from '@/components/organization/organization-context';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { AppShell } from '@/components/sidebar/app-shell';
import { ClockFAB } from '@/components/clock-fab';
import { ActiveJobsProvider } from '@/components/active-jobs-provider';
import { ClockStateProvider } from '@/components/clock-state-provider';
import { AppShellSkeleton } from '@/components/sidebar/app-shell-skeleton';
import {
  getCachedUser,
  getCachedMemberships,
  getCachedSubscriptionStatus,
  getCachedUserProfile,
} from '@/lib/data/cached';
import {
  getActiveJobIdsForOrg,
  getCurrentClockState,
  getPendingApprovalCount,
} from '@/lib/time-tracking/actions';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { ONBOARDING_START_PATH } from '@/lib/auth/redirects';
import { resolveActiveOrgId } from '@/lib/org/cookies';

async function getInitialAppRuntimeState({
  activeOrgId,
  role,
}: {
  activeOrgId: string | null;
  role: string | undefined;
}): Promise<{
  clockState: LiveClockState | null;
  activeJobIds: string[];
  pendingApprovalCount: number;
}> {
  if (!activeOrgId) {
    return {
      clockState: null,
      activeJobIds: [],
      pendingApprovalCount: 0,
    };
  }

  const canViewPendingApprovals = role === 'admin' || role === 'buero';
  const [clockStateResult, activeJobsResult, pendingApprovalCount] =
    await Promise.all([
      getCurrentClockState(activeOrgId),
      getActiveJobIdsForOrg(activeOrgId),
      canViewPendingApprovals
        ? getPendingApprovalCount(activeOrgId, role === 'admin')
        : Promise.resolve(0),
    ]);

  return {
    clockState: clockStateResult.success ? clockStateResult.state : null,
    activeJobIds: activeJobsResult.success ? activeJobsResult.activeJobIds : [],
    pendingApprovalCount,
  };
}

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

  if (memberships.length === 0) {
    redirect(ONBOARDING_START_PATH);
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);
  const initialRuntimeState = await getInitialAppRuntimeState({
    activeOrgId,
    role: currentMembership?.role,
  });

  return (
    <OrganizationProvider
      initialMemberships={memberships}
      initialActiveOrgId={activeOrgId}
      initialIsSubscribed={isSubscribed}
    >
      <RealtimeProvider>
        <UserProfileProvider initialProfile={profile}>
          <ActiveJobsProvider
            initialActiveJobIds={initialRuntimeState.activeJobIds}
            initialOrganizationId={activeOrgId}
          >
            <ClockStateProvider initialState={initialRuntimeState.clockState}>
              <AppShell
                initialPendingApprovalCount={
                  initialRuntimeState.pendingApprovalCount
                }
                initialOrganizationId={activeOrgId}
              >
                {children}
              </AppShell>
              <ClockFAB />
            </ClockStateProvider>
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
