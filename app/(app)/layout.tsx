import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OrganizationProvider } from '@/components/organization/organization-context';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { BannerProvider } from '@/components/ui/banner';
import { OpenDialogProvider } from '@/components/ui/open-dialog-context';
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
import { reportAuthUsersStringColumnHealth } from '@/lib/supabase/auth-health';
import {
  getActiveJobIdsForOrg,
  getCurrentClockState,
} from '@/lib/time-tracking/actions';
import { getAttentionCounts } from '@/lib/attention/actions';
import type { AttentionCounts } from '@/lib/attention/types';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { ONBOARDING_START_PATH } from '@/lib/auth/redirects';
import { resolveActiveOrgId } from '@/lib/org/cookies';

async function getInitialAppRuntimeState({
  activeOrgId,
}: {
  activeOrgId: string | null;
}): Promise<{
  clockState: LiveClockState | null;
  activeJobIds: string[];
  attentionCounts: AttentionCounts | undefined;
}> {
  if (!activeOrgId) {
    return {
      clockState: null,
      activeJobIds: [],
      attentionCounts: undefined,
    };
  }

  const [clockStateResult, activeJobsResult, attentionCountsResult] =
    await Promise.all([
      getCurrentClockState(activeOrgId),
      getActiveJobIdsForOrg(activeOrgId),
      getAttentionCounts(),
    ]);

  return {
    clockState: clockStateResult.success ? clockStateResult.state : null,
    activeJobIds: activeJobsResult.success ? activeJobsResult.activeJobIds : [],
    // undefined lets the provider fetch on mount instead of trusting a failed
    // initial load as "zero".
    attentionCounts: attentionCountsResult.success
      ? attentionCountsResult.counts
      : undefined,
  };
}

async function AppProviders({ children }: { children: React.ReactNode }) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) redirect('/login');

  await reportAuthUsersStringColumnHealth('app-layout');

  const [memberships, isSubscribed, activeOrgId, profile] = await Promise.all([
    getCachedMemberships(user.id),
    getCachedSubscriptionStatus(user.id),
    resolveActiveOrgId(cookieStore, user.id),
    getCachedUserProfile(user.id, user.email!),
  ]);

  if (memberships.length === 0) {
    redirect(ONBOARDING_START_PATH);
  }

  const initialRuntimeState = await getInitialAppRuntimeState({
    activeOrgId,
  });

  return (
    <OrganizationProvider
      initialMemberships={memberships}
      initialActiveOrgId={activeOrgId}
      initialIsSubscribed={isSubscribed}
    >
      <RealtimeProvider>
        <UserProfileProvider initialProfile={profile}>
          <OpenDialogProvider>
            <BannerProvider>
              <ActiveJobsProvider
                initialActiveJobIds={initialRuntimeState.activeJobIds}
                initialOrganizationId={activeOrgId}
              >
                <ClockStateProvider initialState={initialRuntimeState.clockState}>
                  <AppShell
                    initialAttentionCounts={initialRuntimeState.attentionCounts}
                    initialOrganizationId={activeOrgId}
                  >
                    {children}
                  </AppShell>
                  <ClockFAB />
                </ClockStateProvider>
              </ActiveJobsProvider>
            </BannerProvider>
          </OpenDialogProvider>
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
