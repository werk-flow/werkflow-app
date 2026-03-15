'use server';

import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';

export type CancelInviteResult = {
  success: boolean;
  error?: string;
};

export async function cancelInvite(
  inviteId: string
): Promise<CancelInviteResult> {
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

    const memberships = await getCachedMemberships(user.id);
    const membership = memberships.find((m) => m.orgId === orgId);

    if (!membership) {
      return { success: false, error: 'not_a_member' };
    }

    if (membership.role !== 'admin' && membership.role !== 'manager') {
      return { success: false, error: 'not_authorized' };
    }

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
