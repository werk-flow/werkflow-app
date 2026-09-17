import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OrganizationProvider } from '@/components/organization/organization-context';
import { OrganizationRealtimeBridge } from '@/components/organization/organization-realtime-bridge';
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
import { getAuthenticatedRedirectPath } from '@/lib/auth/redirects';
import { CURRENT_ORG_COOKIE, resolveActiveOrgId } from '@/lib/org/cookies';

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
    redirect(await getAuthenticatedRedirectPath(user.id));
  }

  const activeOrgCookieNeedsSync =
    activeOrgId !== null &&
    cookieStore.get(CURRENT_ORG_COOKIE)?.value !== activeOrgId;

  return (
    <BannerProvider>
      <OrganizationProvider
        initialMemberships={memberships}
        initialActiveOrgId={activeOrgId}
        initialActiveOrgCookieNeedsSync={activeOrgCookieNeedsSync}
        initialIsSubscribed={isSubscribed}
      >
        <RealtimeProvider>
          <UserProfileProvider initialProfile={profile}>
            <OpenDialogProvider>
              <OrganizationRealtimeBridge />
              {/* Optional runtime reads must not hold every route refresh. */}
              <ActiveJobsProvider>
                <ClockStateProvider>
                  <AppShell
                    initialOrganizationId={activeOrgId}
                  >
                    {children}
                  </AppShell>
                  <ClockFAB />
                </ClockStateProvider>
              </ActiveJobsProvider>
            </OpenDialogProvider>
          </UserProfileProvider>
        </RealtimeProvider>
      </OrganizationProvider>
    </BannerProvider>
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
