'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { CURRENT_ORG_COOKIE } from '@/lib/org/cookies';

// Role hierarchy for permission checks
// Lower number = higher rank
const ROLE_HIERARCHY: Record<string, number> = {
  admin: 1,
  manager: 2,
  accountant: 3,
  secretary: 4,
  employee: 5
};

export type OrgRole =
  | 'admin'
  | 'manager'
  | 'accountant'
  | 'secretary'
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const cookieStore = await cookies();
    const orgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Get the caller's membership in this org
    const { data: callerMembership, error: callerError } = await supabase
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
    if (callerRole !== 'admin' && callerRole !== 'manager') {
      return { success: false, error: 'not_authorized' };
    }

    // Get the target member's current role using admin client to bypass RLS
    const admin = createSupabaseAdminClient();
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

    // Cannot change own role
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

    // Managers have additional restrictions
    if (callerRole === 'manager') {
      // Manager cannot change another manager's role (or anyone at/above manager level)
      if (ROLE_HIERARCHY[targetRole] <= ROLE_HIERARCHY['manager']) {
        return { success: false, error: 'insufficient_permissions' };
      }
      // Manager can only assign roles below manager level (not manager itself)
      if (ROLE_HIERARCHY[newRole] <= ROLE_HIERARCHY['manager']) {
        return { success: false, error: 'cannot_assign_manager_role' };
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
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const cookieStore = await cookies();
    const orgId = cookieStore.get(CURRENT_ORG_COOKIE)?.value;

    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Get the caller's membership in this org
    const { data: callerMembership, error: callerError } = await supabase
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
    if (callerRole !== 'admin' && callerRole !== 'manager') {
      return { success: false, error: 'not_authorized' };
    }

    // Get the target member's current role using admin client to bypass RLS
    const admin = createSupabaseAdminClient();
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

    // Managers can only remove users below manager level
    if (callerRole === 'manager') {
      // Manager cannot remove another manager
      if (ROLE_HIERARCHY[targetRole] <= ROLE_HIERARCHY['manager']) {
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

    return { success: true };
  } catch (error) {
    console.error('Unexpected error in removeMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
