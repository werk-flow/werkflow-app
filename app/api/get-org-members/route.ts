import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { OrgRole } from '@/lib/members/actions';

export async function POST(request: Request) {
  try {
    const { organizationId } = await request.json();

    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization ID is required' },
        { status: 400 }
      );
    }

    const supabase = await createSupabaseServerClient();

    // Get current user
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Check if user is admin or manager in this org
    const { data: membership } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', organizationId)
      .eq('user_id', user.id)
      .single();

    if (!membership) {
      return NextResponse.json({ error: 'Not a member' }, { status: 403 });
    }

    const userRole = membership.role as OrgRole;
    const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

    if (!isAdminOrManager) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    // Get organization members using the RPC
    const { data: members, error } = await supabase.rpc('get_org_members', {
      p_org_id: organizationId
    });

    if (error) {
      console.error('Error fetching members:', error);
      return NextResponse.json(
        { error: 'Failed to fetch members' },
        { status: 500 }
      );
    }

    // Filter members based on role (managers can only see managed roles)
    let filteredMembers = members || [];

    if (userRole === 'manager') {
      const MANAGED_ROLES: OrgRole[] = ['accountant', 'secretary', 'employee'];
      filteredMembers = filteredMembers.filter(
        (m: { role: OrgRole }) =>
          MANAGED_ROLES.includes(m.role) || m.role === 'manager'
      );
    }

    return NextResponse.json({ members: filteredMembers });
  } catch (error) {
    console.error('Error in get-org-members API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
