import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SettingsShell } from '@/components/settings/settings-shell';
import { EinstellungenContentSkeleton } from '@/components/loading-states/einstellungen-page-skeleton';
import { getCachedMemberships, getCachedUser } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';

// The membership check streams behind Suspense so the settings shell (header
// and section nav) renders immediately instead of blocking every settings
// page — including the fully static ones — on the organization lookup.
async function SettingsAccessGuard({
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

  return <>{children}</>;
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsShell>
      <Suspense fallback={<EinstellungenContentSkeleton />}>
        <SettingsAccessGuard>{children}</SettingsAccessGuard>
      </Suspense>
    </SettingsShell>
  );
}
