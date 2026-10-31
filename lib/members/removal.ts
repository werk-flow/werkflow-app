import 'server-only';

// The checks and the failure mapping of removeMember (lib/members/actions.ts).
// The action establishes the caller and re-reads the caller's role before it
// calls them; this module is not a 'use server' file, so its parameters never
// become public action arguments.

import type { ActionFailure } from '@/lib/action-result';
import { getResponsibilitiesStrandedByMemberRemoval } from '@/lib/responsibilities/server';
import { strandedResponsibilityOf } from '@/lib/responsibilities/types';
import { bueroMayManage, type OrgRole } from '@/lib/roles';
import type { AdminClient } from '@/lib/supabase/admin';
import type { StrandedResponsibilityFailure } from './actions';

/**
 * The refusal of removing `memberId` from the caller's organization, or null
 * when the caller may remove that member: the member exists, is not the
 * caller and not the admin, and a Büro caller may manage the member's role.
 */
export async function memberTargetRefusal(
  admin: AdminClient,
  removal: { organizationId: string; callerId: string; callerRole: OrgRole; memberId: string },
): Promise<ActionFailure | null> {
  const { data: targetMember, error: targetError } = await admin
    .from('organization_members')
    .select('user_id, role')
    .eq('organization_id', removal.organizationId)
    .eq('user_id', removal.memberId)
    .single();

  if (targetError || !targetMember) {
    return { success: false, error: 'member_not_found' };
  }

  const targetRole = targetMember.role;

  // Cannot remove self
  if (targetMember.user_id === removal.callerId) {
    return { success: false, error: 'cannot_remove_self' };
  }

  // Cannot remove the admin
  if (targetRole === 'admin') {
    return { success: false, error: 'cannot_remove_admin' };
  }

  // Büro users can only remove employees
  if (removal.callerRole === 'buero') {
    if (!bueroMayManage(targetRole)) {
      return { success: false, error: 'insufficient_permissions' };
    }
  }
  return null;
}

/**
 * Names every responsibility the removal would leave without an effective
 * holder, at once; the membership trigger is the backstop and names only the
 * first. Null when none would.
 */
export async function strandedRemovalRefusal(
  organizationId: string,
  memberId: string,
): Promise<ActionFailure | StrandedResponsibilityFailure | null> {
  const strandedResponsibilities = await getResponsibilitiesStrandedByMemberRemoval({
    organizationId,
    userId: memberId,
  });
  if (!strandedResponsibilities) {
    return { success: false, error: 'delete_failed' };
  }
  if (strandedResponsibilities.length > 0) {
    return {
      success: false,
      error: 'last_responsibility_holder',
      responsibilities: strandedResponsibilities,
    };
  }
  return null;
}

/** The failure of a refused remove_member_with_time_capture call. */
export function memberRemovalFailure(deleteError: {
  message: string;
}): ActionFailure | StrandedResponsibilityFailure {
  // SI-006 containment: recorded time keeps the member; offboarding runs
  // through the P1-24 employment transitions until P1-33.
  if (deleteError.message.includes('time_member_removal_has_history')) {
    return { success: false, error: 'has_time_history' };
  }
  if (deleteError.message.includes('member_removal_exit_before_entry')) {
    return { success: false, error: 'exit_before_entry' };
  }
  const strandedResponsibility = strandedResponsibilityOf(deleteError.message);
  if (strandedResponsibility) {
    return {
      success: false,
      error: 'last_responsibility_holder',
      responsibilities: [strandedResponsibility],
    };
  }
  return { success: false, error: 'delete_failed' };
}
