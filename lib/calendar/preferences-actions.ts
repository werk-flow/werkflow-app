'use server';

import { updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { calendarPreferencesSchema, writeCalendarPreferencesJson } from './preferences';

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
  // A fresh read, not the cached row: another key of the same JSON may have changed since the cache filled.
  const admin = createSupabaseAdminClient();
  const { data: current, error: readError } = await admin
    .from('organization_user_preferences')
    .select('preferences')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) {
    logError('Error reading calendar preferences', readError);
    return { success: false, error: 'update_failed' };
  }
  const { error } = await admin.from('organization_user_preferences').upsert(
    {
      organization_id: orgId,
      user_id: userId,
      preferences: writeCalendarPreferencesJson(current?.preferences ?? null, parsed.data),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,user_id' },
  );
  if (error) {
    logError('Error saving calendar preferences', error);
    return { success: false, error: 'update_failed' };
  }
  updateTag(CACHE_TAGS.organizationUserPreferences(orgId, userId));
  return { success: true };
}
