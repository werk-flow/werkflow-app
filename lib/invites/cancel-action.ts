'use server';

import { cookies } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';

export type CancelInviteResult = {
  success: boolean;
  error?: string;
};

/**
 * Cancel a pending invitation.
 * 
 * Rules:
 * - Only admins and managers can cancel invites
 * - Only pending invites can be cancelled
 */
export async function cancelInvite(
  inviteId: string
): Promise<CancelInviteResult> {
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

    // Only admins and managers can cancel invites
    if (membership.role !== 'admin' && membership.role !== 'manager') {
      return { success: false, error: 'not_authorized' };
    }

    // Use admin client for database operations that need to bypass RLS
    const admin = createSupabaseAdminClient();

    // Verify the invite belongs to this organization
    // Use admin client to bypass RLS (SELECT is allowed but UPDATE is not)
    const { data: invite, error: inviteErr } = await admin
      .from('organization_invites')
      .select('id, status')
      .eq('id', inviteId)
      .eq('organization_id', orgId)
      .single();

    if (inviteErr || !invite) {
      return { success: false, error: 'invite_not_found' };
    }

    // Only allow cancelling pending invites - provide specific error messages
    if (invite.status === 'cancelled') {
      return { success: false, error: 'already_cancelled' };
    }
    if (invite.status === 'accepted') {
      return { success: false, error: 'already_accepted' };
    }
    if (invite.status === 'expired') {
      return { success: false, error: 'already_expired' };
    }
    if (invite.status !== 'pending') {
      return { success: false, error: 'invite_not_pending' };
    }

    // Update invite status to cancelled using admin client (no UPDATE policy)
    const { error: updateErr } = await admin
      .from('organization_invites')
      .update({ status: 'cancelled' })
      .eq('id', inviteId);

    if (updateErr) {
      console.error('Error cancelling invite:', updateErr);
      return { success: false, error: 'cancel_failed' };
    }

    return { success: true };
  } catch (error) {
    console.error('Unexpected error cancelling invite:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
