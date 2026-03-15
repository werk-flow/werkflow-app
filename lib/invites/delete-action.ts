'use server';

import { cookies } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';

export type DeleteInviteResult = {
  success: boolean;
  error?: string;
};

export async function deleteInvite(
  inviteId: string
): Promise<DeleteInviteResult> {
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

