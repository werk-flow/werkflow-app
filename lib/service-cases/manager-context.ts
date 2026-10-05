import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type ServiceAdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** The verified office caller of a service-case or maintenance operation. */
export type ServiceManagerContext = {
  admin: ServiceAdminClient;
  organizationId: string;
  actorId: string;
};

/**
 * Service cases and maintenance are office work: the caller must be a current
 * admin or Büro member of the active organization. The admin client is
 * created only after that check.
 */
export async function requireServiceManager(): Promise<ServiceManagerContext | ActionFailure> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return {
    admin: createSupabaseAdminClient(),
    organizationId: auth.context.orgId,
    actorId: auth.context.userId,
  };
}
