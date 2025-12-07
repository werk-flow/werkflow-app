import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import {
  getCachedUser,
  getCachedMemberships,
  getCachedSubscriptionStatus,
  getCachedUserProfile
} from '@/lib/data/cached';
import { OrganizationProvider } from '@/components/organization/organization-context';
import { UserProfileProvider } from '@/components/user/user-profile-context';
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

  // Read active org from cookie
  const cookieStore = await cookies();
  const storedOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

  // Validate stored org ID against memberships, fallback to first org
  // Note: The middleware handles setting the cookie if it's missing/invalid
  // Here we just determine what the active org should be for the UI
  let activeOrgId: string | null = null;
  if (storedOrgId && memberships.some((m) => m.orgId === storedOrgId)) {
    activeOrgId = storedOrgId;
  } else if (memberships.length > 0) {
    // Fallback to first org - ensures there's ALWAYS an active org when user has memberships
    activeOrgId = memberships[0].orgId;
  }

  return (
    <OrganizationProvider
      initialMemberships={memberships}
      initialActiveOrgId={activeOrgId}
      initialIsSubscribed={subscribed}
    >
      <UserProfileProvider initialProfile={userProfile}>
        <AppShell>{children}</AppShell>
        <ClockFAB />
      </UserProfileProvider>
    </OrganizationProvider>
  );
}
