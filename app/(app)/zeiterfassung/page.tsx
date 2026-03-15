import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { ZeiterfassungHeader } from '@/components/zeiterfassung/zeiterfassung-header';
import { ZeiterfassungContent } from '@/components/zeiterfassung/zeiterfassung-content';
import { ZeiterfassungContentSkeleton } from '@/components/loading-states/zeiterfassung-content-skeleton';
import {
  getPendingSessions,
  getPendingChangeRequests
} from '@/lib/time-tracking/actions';
import type { OrgRole } from '@/lib/members/actions';

async function ZeiterfassungData({
  activeOrgId,
  userId,
  isAdminOrManager,
  isAdmin,
  currentUserRole,
  tab
}: {
  activeOrgId: string;
  userId: string;
  isAdminOrManager: boolean;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  tab: string | undefined;
}) {
  let initialPendingCount = 0;
  let members: Array<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    role: string;
  }> = [];

  if (isAdminOrManager) {
    const supabase = await createSupabaseServerClient();

    const [sessionsResult, changeRequestsResult, { data: membersData }] =
      await Promise.all([
        getPendingSessions(activeOrgId),
        isAdmin ? getPendingChangeRequests(activeOrgId) : null,
        supabase.rpc('get_org_members', { p_org_id: activeOrgId })
      ]);

    if (sessionsResult.success) {
      initialPendingCount += sessionsResult.sessions.length;
    }
    if (changeRequestsResult?.success) {
      initialPendingCount += changeRequestsResult.requests.length;
    }

    if (membersData) {
      if (currentUserRole === 'manager') {
        const MANAGED_ROLES = ['accountant', 'secretary', 'employee'];
        members = membersData.filter(
          (m: { role: string; user_id: string }) =>
            MANAGED_ROLES.includes(m.role) || m.user_id === userId
        );
      } else {
        members = membersData;
      }
    }
  }

  return (
    <ZeiterfassungContent
      organizationId={activeOrgId}
      userId={userId}
      isAdminOrManager={isAdminOrManager}
      isAdmin={isAdmin}
      currentUserRole={currentUserRole}
      initialTab={tab === 'approvals' ? 'approvals' : 'overview'}
      initialPendingCount={initialPendingCount}
      members={members}
    />
  );
}

interface ZeiterfassungPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ZeiterfassungPage({
  searchParams
}: ZeiterfassungPageProps) {
  const [{ tab }, { data: { user } }, cookieStore] = await Promise.all([
    searchParams,
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id)
  ]);

  if (!activeOrgId) {
    return (
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Zeiterfassung</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  if (!currentMembership) {
    redirect('/dashboard');
  }

  const currentUserRole = currentMembership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';
  const isAdmin = currentUserRole === 'admin';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ZeiterfassungHeader />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Suspense fallback={<ZeiterfassungContentSkeleton />}>
          <ZeiterfassungData
            activeOrgId={activeOrgId}
            userId={user.id}
            isAdminOrManager={isAdminOrManager}
            isAdmin={isAdmin}
            currentUserRole={currentUserRole}
            tab={tab}
          />
        </Suspense>
      </div>
    </div>
  );
}
