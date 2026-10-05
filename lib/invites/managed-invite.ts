import 'server-only';

import { cookies } from 'next/headers';
import type { ActionResult } from '@/lib/action-result';
import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { isManagerRole } from '@/lib/roles';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';

export type ManagedInvite = { admin: AdminClient; orgId: string; inviteId: string; status: string };

/**
 * Resolves the caller as admin or Büro of the active organization and loads
 * one invite of that organization. The callers write through the returned
 * admin client because `organization_invites` has no UPDATE policy.
 */
export async function requireManagedInvite(
  inviteId: string,
): Promise<ActionResult<{ invite: ManagedInvite }>> {
  const [user, cookieStore] = await Promise.all([getAuthenticatedUser(), cookies()]);
  if (!user) return { success: false, error: 'not_authenticated' };

  const orgId = await resolveActiveOrgId(cookieStore, user.id);
  if (!orgId) return { success: false, error: 'no_active_org' };

  const memberships = await getCachedMemberships(user.id);
  const membership = memberships.find((m) => m.orgId === orgId);
  if (!membership) return { success: false, error: 'not_a_member' };
  if (!isManagerRole(membership.role)) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const { data: invite, error: inviteError } = await admin
    .from('organization_invites')
    .select('id, status')
    .eq('id', inviteId)
    .eq('organization_id', orgId)
    .single();
  if (inviteError || !invite) return { success: false, error: 'invite_not_found' };

  return { success: true, invite: { admin, orgId, inviteId, status: invite.status } };
}
