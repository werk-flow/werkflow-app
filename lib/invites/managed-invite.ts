import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { resolveActionContext } from '@/lib/org/action-context';
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
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  const { orgId, isManagerOrAbove } = auth.context;
  if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

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
