'use server';

import { updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import {
  AUFTRAEGE_VISIBLE_COLUMNS_PREFERENCE_PATH,
  auftraegeColumnPreferencesSchema,
  type AuftraegeColumnPreferencesValues,
} from '@/lib/jobs/auftraege-table-columns';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { CACHE_TAGS } from '@/lib/data/cached';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
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
  const nextVisibleColumns = parsed.data.visibleColumns;
  // Sets this one key in the stored document; a concurrent save of another key survives.
  const { error } = await createSupabaseAdminClient().rpc(
    'set_organization_user_preference',
    rpcArgs('set_organization_user_preference', {
      p_organization_id: orgId,
      p_user_id: userId,
      p_path: AUFTRAEGE_VISIBLE_COLUMNS_PREFERENCE_PATH,
      p_value: nextVisibleColumns,
    }),
  );
  if (error?.message === 'not_a_member' || error?.message === 'invalid_input') {
    return { success: false, error: error.message };
  }
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
