import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';
import { getCachedUser } from '@/lib/data/cached';
import { CalendarContainer } from '@/components/kalender/calendar-container';
import type { OrgRole } from '@/lib/supabase/database.types';

export default async function KalenderPage() {
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
        <h1 className="text-2xl font-bold">Kalender</h1>
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

  // For admin/manager: fetch all members
  // For regular employees: just need their own entries
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
          (m: { role: string }) =>
            MANAGED_ROLES.includes(m.role) || m.user_id === user.id
        );
      } else {
        members = membersData;
      }
    }
  }

  return (
    <CalendarContainer
      organizationId={activeOrgId}
      currentUserId={user.id}
      currentUserRole={currentUserRole}
      isAdminOrManager={isAdminOrManager}
      members={members}
    />
  );
}
