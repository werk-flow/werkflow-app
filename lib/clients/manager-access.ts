import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';

export type ClientManagerContext = {
  orgId: string;
  userId: string;
  admin: AdminClient;
};

/**
 * The guard of every write and read on one customer's data: the caller is an
 * admin or Büro member, and the customer belongs to the caller's active
 * organization. A foreign or unknown id answers `client_not_found`.
 */
export async function requireManagerAndClient(
  clientId: string,
): Promise<ActionResult<{ context: ClientManagerContext }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;
  if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const { data: client, error } = await admin
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error) logReadFailure('requireManagerAndClient: client read failed', error);
  if (error || !client) return { success: false, error: 'client_not_found' };

  return { success: true, context: { orgId, userId, admin } };
}
