'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';

export type DeleteInviteResult = {
  success: boolean;
  error?: string;
};

/**
 * Delete an invitation from the database.
 * 
 * Rules:
 * - Only admins and managers can delete invites
 * - Only cancelled, accepted, or expired invites can be deleted
 * - Pending invites must be cancelled first before deletion
 */
export async function deleteInvite(
  inviteId: string
): Promise<DeleteInviteResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const cookieStore = await cookies();
    const orgId = await resolveActiveOrgId(cookieStore, user.id);

    if (!orgId) {
      return { success: false, error: 'no_active_org' };
    }

    // Check user's role in this organization
    const { data: membership, error: membershipErr } = await supabase
      .from('organization_members')
      .select('role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .single();

    if (membershipErr || !membership) {
      return { success: false, error: 'not_a_member' };
    }

    // Only admins and managers can delete invites
    if (membership.role !== 'admin' && membership.role !== 'manager') {
      return { success: false, error: 'not_authorized' };
    }

    // Use admin client for database operations
    const admin = createSupabaseAdminClient();

    // Verify the invite belongs to this organization and check its status
    const { data: invite, error: inviteErr } = await admin
      .from('organization_invites')
      .select('id, status')
      .eq('id', inviteId)
      .eq('organization_id', orgId)
      .single();

    if (inviteErr || !invite) {
      return { success: false, error: 'invite_not_found' };
    }

    // Only allow deleting non-pending invites
    if (invite.status === 'pending') {
      return { success: false, error: 'must_cancel_first' };
    }

    // Delete the invite
    const { error: deleteErr } = await admin
      .from('organization_invites')
      .delete()
      .eq('id', inviteId);

    if (deleteErr) {
      console.error('Error deleting invite:', deleteErr);
      return { success: false, error: 'delete_failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error deleting invite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

