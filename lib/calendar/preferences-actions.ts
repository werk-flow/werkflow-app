'use server';

import { updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { uuidSchema } from '@/lib/validation/uuid';
import { CALENDAR_PREFERENCE_PATH, calendarPreferencesSchema } from './preferences';

export type SaveCalendarPreferencesResult = ActionResult<
  object,
  | 'not_authenticated'
  | 'no_active_org'
  | 'not_a_member'
  | 'invalid_input'
  | 'update_failed'
  | 'organization_changed'
>;

/**
 * Stores the caller's own calendar preferences for the active organization.
 * The row is keyed by organization and user, so one member can never write
 * another member's preferences; the value is validated before it is stored.
 */
export async function saveCalendarPreferences(
  organizationId: string,
  input: unknown,
): Promise<SaveCalendarPreferencesResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) {
    if (
      auth.error === 'not_authenticated' ||
      auth.error === 'no_active_org' ||
      auth.error === 'not_a_member'
    ) {
      return { success: false, error: auth.error };
    }
    return { success: false, error: 'update_failed' };
  }
  // A value that is no uuid can never name the active organization.
  const parsedOrganizationId = uuidSchema.safeParse(organizationId);
  if (!parsedOrganizationId.success || parsedOrganizationId.data !== auth.context.orgId) {
    return { success: false, error: 'organization_changed' };
  }
  const parsed = calendarPreferencesSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };

  const { orgId, userId } = auth.context;
  // Sets this one key in the stored document; a concurrent save of another key survives.
  const { error } = await createSupabaseAdminClient().rpc(
    'set_organization_user_preference',
    rpcArgs('set_organization_user_preference', {
      p_organization_id: orgId,
      p_user_id: userId,
      p_path: CALENDAR_PREFERENCE_PATH,
      p_value: parsed.data,
    }),
  );
  if (error?.message === 'not_a_member' || error?.message === 'invalid_input') {
    return { success: false, error: error.message };
  }
  if (error) {
    logError('Error saving calendar preferences', error);
    return { success: false, error: 'update_failed' };
  }
  updateTag(CACHE_TAGS.organizationUserPreferences(orgId, userId));
  return { success: true };
}
