'use server';

import { updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import {
  buildAuftraegePreferencesJson,
  auftraegeColumnPreferencesSchema,
  type AuftraegeColumnPreferencesValues,
} from '@/lib/jobs/auftraege-table-columns';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging';

export type SaveAuftraegeColumnPreferencesResult = ActionResult<
  { visibleColumns: AuftraegeColumnPreferencesValues['visibleColumns'] },
  'not_authenticated' | 'no_active_org' | 'not_a_member' | 'invalid_input' | 'update_failed'
>;

export async function saveAuftraegeColumnPreferences(
  input: AuftraegeColumnPreferencesValues,
): Promise<SaveAuftraegeColumnPreferencesResult> {
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

  const parsed = auftraegeColumnPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const { orgId, userId } = auth.context;
  const admin = createSupabaseAdminClient();
  // A fresh read, not the cached row: another key of the same JSON may have changed since the cache filled.
  const { data: current, error: readError } = await admin
    .from('organization_user_preferences')
    .select('preferences')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) {
    logError('Error reading Auftraege column preferences', readError);
    return { success: false, error: 'update_failed' };
  }
  const nextVisibleColumns = parsed.data.visibleColumns;

  const { error } = await admin.from('organization_user_preferences').upsert(
    {
      organization_id: orgId,
      user_id: userId,
      preferences: buildAuftraegePreferencesJson(nextVisibleColumns, current?.preferences ?? null),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'organization_id,user_id',
    },
  );

  if (error) {
    logError('Error saving Auftraege column preferences', error);
    return { success: false, error: 'update_failed' };
  }

  updateTag(CACHE_TAGS.organizationUserPreferences(orgId, userId));

  return {
    success: true,
    visibleColumns: nextVisibleColumns,
  };
}
