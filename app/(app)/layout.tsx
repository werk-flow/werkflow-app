import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getCachedUser,
  getCachedMemberships,
  getCachedSubscriptionStatus,
  getCachedUserProfile
} from '@/lib/data/cached';
import { OrganizationProvider } from '@/components/organization/organization-context';
import { UserProfileProvider } from '@/components/user/user-profile-context';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { AppShell } from '@/components/sidebar/app-shell';
import { ClockFAB } from '@/components/clock-fab';

export default async function AppLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Use cached user fetch - deduplicates if page also calls this
  const {
    data: { user }
  } = await getCachedUser();

  if (!user) {
    redirect('/login');
  }

  // Fetch memberships, subscription status, and profile in parallel using cached functions
  const [memberships, subscribed, userProfile] = await Promise.all([
    getCachedMemberships(user.id),
    getCachedSubscriptionStatus(user.id),
    getCachedUserProfile(user.id, user.email ?? '')
  ]);

  // If user has no organizations, redirect to onboarding
  if (memberships.length === 0) {
    if (subscribed) {
      // User is subscribed but has no orgs - redirect to create organization
      redirect('/onboarding/create-organization');
    } else {
      // User is not subscribed - redirect to onboarding start
      redirect('/onboarding/start');
    }
  }

  const cookieStore = await cookies();
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  return (
    <OrganizationProvider
      initialMemberships={memberships}
      initialActiveOrgId={activeOrgId}
      initialIsSubscribed={subscribed}
    >
      <RealtimeProvider>
        <UserProfileProvider initialProfile={userProfile}>
          <AppShell>{children}</AppShell>
          <ClockFAB />
        </UserProfileProvider>
      </RealtimeProvider>
    </OrganizationProvider>
  );
}
