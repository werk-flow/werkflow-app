import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { ZeiterfassungHeader } from '@/components/zeiterfassung/zeiterfassung-header';
import { ZeiterfassungContent } from '@/components/zeiterfassung/zeiterfassung-content';
import {
  getPendingSessions,
  getPendingChangeRequests
} from '@/lib/time-tracking/actions';
import type { OrgRole } from '@/lib/members/actions';

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

  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

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

  const memberships = await getCachedMemberships(user.id);
  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  if (!currentMembership) {
    redirect('/dashboard');
  }

  const currentUserRole = currentMembership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';
  const isAdmin = currentUserRole === 'admin';

  // Fetch pending counts and members in parallel
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
            MANAGED_ROLES.includes(m.role) || m.user_id === user.id
        );
      } else {
        members = membersData;
      }
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ZeiterfassungHeader />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <ZeiterfassungContent
          organizationId={activeOrgId}
          userId={user.id}
          isAdminOrManager={isAdminOrManager}
          isAdmin={isAdmin}
          currentUserRole={currentUserRole}
          initialTab={tab === 'approvals' ? 'approvals' : 'overview'}
          initialPendingCount={initialPendingCount}
          members={members}
        />
      </div>
    </div>
  );
}
