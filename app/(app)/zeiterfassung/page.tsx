import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getCachedUser } from '@/lib/data/cached';
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
  const { tab } = await searchParams;
  // Use cached user - deduplicates with layout's call
  const {
    data: { user }
  } = await getCachedUser();

  if (!user) {
    redirect('/login');
  }

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

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

  // Get Supabase client for page-specific queries
  const supabase = await createSupabaseServerClient();

  // Check current user's membership and role in this org
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', activeOrgId)
    .eq('user_id', user.id)
    .single();

  if (!membership) {
    redirect('/dashboard');
  }

  const currentUserRole = membership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'manager';
  const isAdmin = currentUserRole === 'admin';

  // Fetch initial pending count on the server for immediate display
  let initialPendingCount = 0;
  if (isAdminOrManager) {
    try {
      const sessionsResult = await getPendingSessions(activeOrgId);
      if (sessionsResult.success) {
        initialPendingCount += sessionsResult.sessions.length;
      }

      if (isAdmin) {
        const changeRequestsResult = await getPendingChangeRequests(
          activeOrgId
        );
        if (changeRequestsResult.success) {
          initialPendingCount += changeRequestsResult.requests.length;
        }
      }
    } catch (err) {
      console.error('Error fetching initial pending count:', err);
    }
  }

  // Fetch members for admin/manager to use in history filter
  let members: Array<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    role: string;
  }> = [];

  if (isAdminOrManager) {
    const { data: membersData } = await supabase.rpc('get_org_members', {
      p_org_id: activeOrgId
    });

    if (membersData) {
      // For managers, filter to only managed roles
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
