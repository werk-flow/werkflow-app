'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import { updateTag } from 'next/cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActionContext, resolveActionContextFor } from '@/lib/org/action-context';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getAuthenticatedUser, CACHE_TAGS } from '@/lib/data/cached';
import { getOrgMembersForUser, getProfileNamesVisibleTo, type ProfileNamesRead } from './queries';
import { memberRemovalFailure, memberTargetRefusal, strandedRemovalRefusal } from './removal';
import { z } from '@/lib/zod';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { Constants } from '@/lib/supabase/database.types';
import { bueroMayManage, type OrgRole } from '@/lib/roles';
import type { OrganizationResponsibility } from '@/lib/responsibilities/types';

const memberRoleChangeSchema = z.object({
  memberId: uuidSchema,
  newRole: z.enum(Constants.public.Enums.org_role),
});
// One page of member names; the callers ask for the people visible in one list.
const profileIdsSchema = z.array(uuidSchema).max(1000);

export type UpdateRoleResult = ActionResult;

/** A removal that would leave a responsibility without an effective holder names every such responsibility. */
export type StrandedResponsibilityFailure = ActionFailure<'last_responsibility_holder'> & {
  responsibilities: OrganizationResponsibility[];
};

export type RemoveMemberResult = ActionResult | StrandedResponsibilityFailure;

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
  memberIdInput: string,
  newRoleInput: OrgRole,
): Promise<UpdateRoleResult> {
  const parsed = memberRoleChangeSchema.safeParse({ memberId: memberIdInput, newRole: newRoleInput });
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { memberId, newRole } = parsed.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId: callerId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    // The role is read again from the membership row, so a membership removed
    // after this request's membership read refuses as not_a_member.
    const { data: callerMembership, error: callerError } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', callerId)
      .single();

    if (callerError || !callerMembership) {
      return { success: false, error: 'not_a_member' };
    }

    const callerRole = callerMembership.role;

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

    const targetRole = targetMember.role;

    if (targetMember.user_id === callerId) {
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
      if (!bueroMayManage(targetRole)) {
        return { success: false, error: 'insufficient_permissions' };
      }
      if (!bueroMayManage(newRole)) {
        return { success: false, error: 'cannot_assign_buero_role' };
      }
    }

    // The role filter keeps a role changed after the checks above (an admin raising
    // the target to Büro) from being overwritten by a decision made on the old role.
    const { data: updatedRows, error: updateError } = await admin
      .from('organization_members')
      .update({ role: newRole })
      .eq('organization_id', orgId)
      .eq('user_id', memberId)
      .eq('role', targetRole)
      .select('user_id');

    if (updateError) {
      logError('Error updating member role:', updateError);
      return { success: false, error: 'update_failed' };
    }
    if (updatedRows.length !== 1) return { success: false, error: 'member_changed' };

    return { success: true };
  } catch (error) {
    logError('Unexpected error in updateMemberRole:', error);
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
export async function removeMember(memberIdInput: string): Promise<RemoveMemberResult> {
  const parsedMemberId = uuidSchema.safeParse(memberIdInput);
  if (!parsedMemberId.success) return { success: false, error: 'invalid_input' };
  const memberId = parsedMemberId.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId: callerId, orgId } = auth.context;

    const admin = createSupabaseAdminClient();

    // The role is read again from the membership row, so a membership removed
    // after this request's membership read refuses as not_a_member.
    const { data: callerMembership, error: callerError } = await admin
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', callerId)
      .single();

    if (callerError || !callerMembership) {
      return { success: false, error: 'not_a_member' };
    }

    const callerRole = callerMembership.role;

    // Only admins and managers can remove members
    if (callerRole !== 'admin' && callerRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const targetRefusal = await memberTargetRefusal(admin, {
      organizationId: orgId,
      callerId,
      callerRole,
      memberId,
    });
    if (targetRefusal) return targetRefusal;

    const strandedRefusal = await strandedRemovalRefusal(orgId, memberId);
    if (strandedRefusal) return strandedRefusal;

    // One transaction: the membership goes, and the personnel record survives
    // marked as exited today with a membership_removed event (P1-03), or
    // nothing changes. P1-33 replaces this flow with real offboarding.
    const { error: deleteError } = await admin.rpc('remove_member_with_time_capture', {
      p_organization_id: orgId,
      p_target_user_id: memberId,
      p_actor_id: callerId,
      p_operation_id: crypto.randomUUID(),
    });

    if (deleteError) {
      logError('Error removing member atomically:', deleteError);
      return memberRemovalFailure(deleteError);
    }

    if (orgId) {
      updateTag(CACHE_TAGS.memberCount(orgId));
    }

    return { success: true };
  } catch (error) {
    logError('Unexpected error in removeMember:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type OrgMemberInfo = {
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: OrgRole;
  joined_at: string;
};

/**
 * Get org members for the authenticated caller.
 * Enforces admin/manager authorization and filters by role for managers.
 * The unauthenticated read helper lives in `lib/members/queries.ts` (SI-014).
 */
export async function getOrgMembersAction(
  organizationIdInput: string,
): Promise<ActionResult<{ members: OrgMemberInfo[] }>> {
  const parsedOrganizationId = uuidSchema.safeParse(organizationIdInput);
  if (!parsedOrganizationId.success) return { success: false, error: 'invalid_input' };
  const organizationId = parsedOrganizationId.data;
  try {
    const auth = await resolveActionContextFor(organizationId);
    if (!auth.success) return auth;
    const { userId, role: userRole } = auth.context;
    if (userRole !== 'admin' && userRole !== 'buero') {
      return { success: false, error: 'not_authorized' };
    }

    const membersRead = await getOrgMembersForUser(organizationId, userId);
    if (!membersRead.success) return membersRead;

    const members =
      userRole === 'buero'
        ? membersRead.members.filter((m) => m.role === 'employee' || m.user_id === userId)
        : membersRead.members;

    return { success: true, members };
  } catch {
    return { success: false, error: 'unexpected_error' };
  }
}

/**
 * Get profile display names for a list of user IDs (server action replacement for /api/get-profiles).
 */
export async function getProfilesByIds(userIdsInput: string[]): Promise<ProfileNamesRead | ActionFailure> {
  const parsedUserIds = profileIdsSchema.safeParse(userIdsInput);
  if (!parsedUserIds.success) return { success: false, error: 'invalid_input' };
  const userIds = parsedUserIds.data;
  if (userIds.length === 0) return { success: true, profiles: {} };

  try {
    // Names are visible only across shared organizations (SI-015).
    const user = await getAuthenticatedUser();
    if (!user) return { success: false, error: 'not_authenticated' };
    return await getProfileNamesVisibleTo(user.id, userIds);
  } catch (error) {
    logError('getProfilesByIds: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
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
export async function getMemberDetail(userIdInput: string): Promise<ActionResult<{ member: MemberDetail }>> {
  const parsedUserId = uuidSchema.safeParse(userIdInput);
  if (!parsedUserId.success) return { success: false, error: 'invalid_input' };
  const userId = parsedUserId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const [membershipResult, profileResult] = await Promise.all([
      admin
        .from('organization_members')
        .select('user_id, role, joined_at')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .single(),
      admin.from('profiles').select('id, first_name, last_name, email').eq('id', userId).single(),
    ]);

    const { data: membership, error: membershipError } = membershipResult;
    const { data: profile, error: profileError } = profileResult;

    // `.single()` reports a missing row as PGRST116; any other error is a failed read, not a missing member.
    const readError = [membershipError, profileError].find((error) => error && error.code !== 'PGRST116');
    if (readError) {
      logReadErrors('getMemberDetail: read failed', readError);
      return { success: false, error: 'load_failed' };
    }
    if (!membership || !profile) return { success: false, error: 'not_found' };

    return {
      success: true,
      member: {
        userId: profile.id,
        firstName: profile.first_name ?? '',
        lastName: profile.last_name ?? '',
        email: profile.email ?? '',
        role: membership.role,
        joinedAt: membership.joined_at,
      },
    };
  } catch (error) {
    logError('Unexpected error in getMemberDetail:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
