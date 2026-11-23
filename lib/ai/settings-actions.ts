'use server';

import type { ActionResult } from '@/lib/action-result';
import { isAiReleasedFor } from '@/lib/ai/release-gate';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';

export type SetAiEnabledResult = ActionResult<
  { enabled: boolean },
  | 'not_authenticated'
  | 'org_not_found'
  | 'invalid_input'
  | 'not_authorized'
  | 'not_released'
  | 'update_failed'
>;

const setAiEnabledSchema = z.object({ enabled: z.boolean() });

/**
 * The admin switches WerkFlow KI on or off for the active organization, once
 * WerkFlow released it. The database function rechecks the admin.
 */
export async function setAiEnabled(input: { enabled: boolean }): Promise<SetAiEnabledResult> {
  const parsed = setAiEnabledSchema.safeParse(input);
  const auth = await resolveActionContext();
  if (!auth.success) {
    return { success: false, error: auth.error === 'not_authenticated' ? auth.error : 'org_not_found' };
  }
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { userId, orgId, role } = auth.context;
  if (role !== 'admin') return { success: false, error: 'not_authorized' };
  if (!isAiReleasedFor(orgId)) return { success: false, error: 'not_released' };

  const { data, error } = await createSupabaseAdminClient().rpc('set_ai_organization_enabled', {
    p_organization_id: orgId,
    p_actor_id: userId,
    p_enabled: parsed.data.enabled,
  });
  if (error) {
    if (error.message === 'ai_setting_not_admin') return { success: false, error: 'not_authorized' };
    logError('setAiEnabled: switch write failed', error);
    return { success: false, error: 'update_failed' };
  }
  return { success: true, enabled: data };
}
