import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SettingsShell } from '@/components/settings/settings-shell';
import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies(),
  ]);

  if (!user) {
    redirect('/login');
  }

  let memberships: Awaited<ReturnType<typeof getCachedMemberships>> = [];
  let activeOrgId: string | null = null;

  try {
    [memberships, activeOrgId] = await Promise.all([
      getCachedMemberships(user.id),
      resolveActiveOrgId(cookieStore, user.id),
    ]);
  } catch (error) {
    console.error('Error loading settings layout organization context:', error);
  }

  const activeMembership =
    memberships.find((membership) => membership.orgId === activeOrgId) ?? memberships[0] ?? null;

  if (!activeMembership) {
    redirect('/dashboard');
  }

  return <SettingsShell>{children}</SettingsShell>;
}
