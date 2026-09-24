'use server';

import { updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { calendarPreferencesSchema, writeCalendarPreferencesJson } from './preferences';

export type SaveCalendarPreferencesResult =
  | { success: true }
  | { success: false; error: 'not_authenticated' | 'no_active_org' | 'not_a_member' | 'invalid_input' | 'update_failed' };

/**
 * Stores the caller's own calendar preferences for the active organization.
 * The row is keyed by organization and user, so one member can never write
 * another member's preferences; the value is validated before it is stored.
 */
export async function saveCalendarPreferences(input: unknown): Promise<SaveCalendarPreferencesResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) {
    if (auth.error === 'not_authenticated' || auth.error === 'no_active_org' || auth.error === 'not_a_member') {
      return { success: false, error: auth.error };
    }
    return { success: false, error: 'update_failed' };
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
    console.error(`Error reading calendar preferences (code=${readError.code ?? 'unknown'})`);
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
    console.error(`Error saving calendar preferences (code=${error.code ?? 'unknown'})`);
    return { success: false, error: 'update_failed' };
  }
  updateTag(CACHE_TAGS.organizationUserPreferences(orgId, userId));
  return { success: true };
}
