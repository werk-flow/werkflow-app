'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getAuthenticatedUser, getCachedMemberships, CACHE_TAGS } from '@/lib/data/cached';

// Role hierarchy for permission checks
// Lower number = higher rank
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 1,
  buero: 2,
  employee: 3
};

export type OrgRole =
  | 'admin'
  | 'buero'
  | 'employee';

export type UpdateRoleResult = {
  success: boolean;
  error?: string;
};

export type RemoveMemberResult = {
  success: boolean;
  error?: string;
};

/**
 * Update a member's role within an organization.
 *
 * Rules:
 * - Only admins and managers can change roles
 * - Cannot change own role
 * - No one can make another user an admin
 * - Admins can change any role to any role (except to admin)
 * - Managers can only change roles of users below manager level
 * - Managers can only assign roles below manager (accountant, secretary, employee)
 */
export async function updateMemberRole(
  memberId: string,
  newRole: OrgRole
): Promise<UpdateRoleResult> {
  try {
    const [user, cookieStore] = await Promise.all([
      getAuthenticatedUser(),
      cookies()
    ]);
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = await resolveActiveOrgId(cookieStore, user.id);

    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const admin = createSupabaseAdminClient();

    const { data: callerMembership, error: callerError } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .single();

    if (callerError || !callerMembership) {
      return { success: false, error: 'not_a_member' };
    }

    const callerRole = callerMembership.role as OrgRole;

    // Only admins and managers can change roles
    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const { data: targetMember, error: targetError } = await admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', orgId)
      .eq('user_id', memberId)
      .single();

    if (targetError || !targetMember) {
      return { success: false, error: 'member_not_found' };
    }

    const targetRole = targetMember.role as OrgRole;

    if (targetMember.user_id === user.id) {
      return { success: false, error: 'cannot_change_own_role' };
    }

    // No one can make another user an admin
    if (newRole === 'admin') {
      return { success: false, error: 'cannot_assign_admin' };
    }

    // Cannot change the admin's role
    if (targetRole === 'admin') {
      return { success: false, error: 'cannot_change_admin_role' };
    }

    // Büro users have additional restrictions
    if (callerRole === 'buero') {
      if (ROLE_HIERARCHY[targetRole] <= ROLE_HIERARCHY['buero']) {
        return { success: false, error: 'insufficient_permissions' };
      }
      if (ROLE_HIERARCHY[newRole] <= ROLE_HIERARCHY['buero']) {
        return { success: false, error: 'cannot_assign_buero_role' };
      }
    }

    // Update the role using admin client
    const { error: updateError } = await admin
      .from('organization_members')
      .update({ role: newRole })
      .eq('organization_id', orgId)
      .eq('user_id', memberId);

    if (updateError) {
      console.error('Error updating member role:', updateError);
      return { success: false, error: 'update_failed' };
    }

    updateTag(CACHE_TAGS.memberships(memberId));

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in updateMemberRole:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Remove a member from an organization.
 *
 * Rules:
 * - Only admins and managers can remove members
 * - Cannot remove self
 * - Admins can remove anyone (except themselves)
 * - Managers can only remove users below manager level (accountant, secretary, employee)
 */
export async function removeMember(
  memberId: string
): Promise<RemoveMemberResult> {
  try {
    const [user, cookieStore] = await Promise.all([
      getAuthenticatedUser(),
      cookies()
    ]);
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const orgId = await resolveActiveOrgId(cookieStore, user.id);

    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    const admin = createSupabaseAdminClient();

    const { data: callerMembership, error: callerError } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .single();

    if (callerError || !callerMembership) {
      return { success: false, error: 'not_a_member' };
    }

    const callerRole = callerMembership.role as OrgRole;

    // Only admins and managers can remove members
    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const { data: targetMember, error: targetError } = await admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', orgId)
      .eq('user_id', memberId)
      .single();

    if (targetError || !targetMember) {
      return { success: false, error: 'member_not_found' };
    }

    const targetRole = targetMember.role as OrgRole;

    // Cannot remove self
    if (targetMember.user_id === user.id) {
      return { success: false, error: 'cannot_remove_self' };
    }

    // Cannot remove the admin
    if (targetRole === 'admin') {
      return { success: false, error: 'cannot_remove_admin' };
    }

    // Büro users can only remove users below their level
    if (callerRole === 'buero') {
      if (ROLE_HIERARCHY[targetRole] <= ROLE_HIERARCHY['buero']) {
        return { success: false, error: 'insufficient_permissions' };
      }
    }

    // If the member is currently working today in this org, insert an automatic clock_out
    // before removal (best-effort). This mirrors "clock out via FAB, then remove from org".
    try {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0
      );
      const todayEnd = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999
      );

      const { data: lastTodayEntry, error: lastEntryError } = await admin
        .from('time_entries')
        .select('entry_type')
        .eq('user_id', memberId)
        .eq('organization_id', orgId)
        .gte('timestamp', todayStart.toISOString())
        .lte('timestamp', todayEnd.toISOString())
        .neq('status', 'rejected')
        .neq('status', 'pending_delete')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!lastEntryError && lastTodayEntry?.entry_type === 'clock_in') {
        const { error: clockOutError } = await admin.from('time_entries').insert({
          user_id: memberId,
          organization_id: orgId,
          entry_type: 'clock_out',
          timestamp: now.toISOString(),
          is_manual: false,
          status: 'approved'
        });

        if (clockOutError) {
          console.error('Error inserting auto clock_out on member removal:', clockOutError);
        }
      } else if (lastEntryError) {
        console.error('Error checking open session on member removal:', lastEntryError);
      }
    } catch (e) {
      console.error('Unexpected error handling auto clock_out on member removal:', e);
    }

    // Delete the member's time entries first (before removing membership)
    const { error: timeEntriesDeleteError } = await admin
      .from('time_entries')
      .delete()
      .eq('user_id', memberId)
      .eq('organization_id', orgId);

    if (timeEntriesDeleteError) {
      console.error(
        'Error deleting member time entries:',
        timeEntriesDeleteError
      );
      return { success: false, error: 'delete_time_entries_failed' };
    }

    // Remove the member using admin client
    const { error: deleteError } = await admin
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', memberId);

    if (deleteError) {
      console.error('Error removing member:', deleteError);
      return { success: false, error: 'delete_failed' };
    }

    updateTag(CACHE_TAGS.memberships(memberId));
    if (orgId) {
      updateTag(CACHE_TAGS.memberCount(orgId));
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in removeMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type OrgMemberInfo = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
};

/**
 * Get org members (server action replacement for /api/get-org-members).
 * Enforces admin/manager authorization and filters by role for managers.
 */
export async function getOrgMembersAction(
  organizationId: string
): Promise<{ success: true; members: OrgMemberInfo[] } | { success: false; error: string }> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const memberships = await getCachedMemberships(user.id);
    const membership = memberships.find((m) => m.orgId === organizationId);

    if (!membership) {
      return { success: false, error: 'not_a_member' };
    }

    const userRole = membership.role as OrgRole;
    if (userRole !== 'admin' && userRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const supabase = await createSupabaseServerClient();
    const { data: members, error } = await supabase.rpc('get_org_members', {
      p_org_id: organizationId
    });

    if (error) {
      return { success: false, error: 'fetch_failed' };
    }

    let filtered = (members ?? []) as OrgMemberInfo[];

    if (userRole === 'buero') {
      filtered = filtered.filter(
        (m) => m.role === 'employee' || m.user_id === user.id
      );
    }

    return { success: true, members: filtered };
  } catch {
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get profile display names for a list of user IDs (server action replacement for /api/get-profiles).
 */
export async function getProfilesByIds(
  userIds: string[]
): Promise<Record<string, { firstName: string | null; lastName: string | null }>> {
  if (!userIds || userIds.length === 0) return {};

  try {
    const admin = createSupabaseAdminClient();
    const { data: profiles, error } = await admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', userIds);

    if (error || !profiles) return {};

    const map: Record<string, { firstName: string | null; lastName: string | null }> = {};
    for (const p of profiles) {
      map[p.id] = { firstName: p.first_name, lastName: p.last_name };
    }
    return map;
  } catch {
    return {};
  }
}

// ============================================
// Member Detail
// ============================================

export type MemberDetail = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
};

/**
 * Get detailed info for a single org member.
 * Requires admin/manager access.
 */
export async function getMemberDetail(
  userId: string
): Promise<
  { success: true; member: MemberDetail } | { success: false; error: string }
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const { data: membership, error: membershipError } = await admin
      .from('organization_members')
      .select('user_id, role, joined_at')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .single();

    if (membershipError || !membership) {
      return { success: false, error: 'not_found' };
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      return { success: false, error: 'not_found' };
    }

    return {
      success: true,
      member: {
        userId: profile.id,
        firstName: profile.first_name ?? '',
        lastName: profile.last_name ?? '',
        email: profile.email ?? '',
        role: membership.role as OrgRole,
        joinedAt: membership.joined_at,
      },
    };
  } catch (error) {
    console.error('Unexpected error in getMemberDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
