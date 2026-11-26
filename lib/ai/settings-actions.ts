'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { isAiReleasedFor } from '@/lib/ai/release-gate';
import { logError } from '@/lib/logging';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

export type SetAiEnabledResult = ActionResult<
  // The row id and write stamp name the save's own Realtime echo (lib/realtime/own-writes.ts);
  // the card waits for the revision.
  { enabled: boolean; id: string; updatedAt: string; revision: number },
  'not_authenticated' | 'not_a_member' | 'invalid_input' | 'not_authorized' | 'not_released' | 'update_failed'
>;

const setAiEnabledSchema = z.object({ organizationId: uuidSchema, enabled: z.boolean() });

/**
 * The admin switches WerkFlow KI on or off for the organization the card
 * showed, once WerkFlow released it: a card left open in another tab never
 * reaches the organization the caller switched to since. The database
 * function rechecks the admin.
 */
export async function setAiEnabled(input: {
  organizationId: string;
  enabled: boolean;
}): Promise<SetAiEnabledResult> {
  const parsed = setAiEnabledSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await resolveActionContextFor(parsed.data.organizationId);
  if (!auth.success) return { success: false, error: auth.error };
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
  // The response renders the settings page, so the card's props carry the saved switch.
  revalidatePath('/einstellungen/organisation');
  return {
    success: true,
    enabled: data.enabled,
    id: data.id,
    updatedAt: data.updated_at,
    revision: data.revision,
  };
}
