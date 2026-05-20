'use server'

import { updateTag } from 'next/cache'

import {
  buildAuftraegePreferencesJson,
  getAuftraegePreferencesFromJson,
  auftraegeColumnPreferencesSchema,
  type AuftraegeColumnPreferencesValues,
} from '@/lib/jobs/auftraege-table-columns'
import { authenticateAndAuthorize } from '@/lib/jobs/auth'
import { CACHE_TAGS, getCachedOrganizationUserPreferences } from '@/lib/data/cached'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type SaveAuftraegeColumnPreferencesResult =
  | { success: true; visibleColumns: AuftraegeColumnPreferencesValues['visibleColumns'] }
  | {
      success: false
      error: 'not_authenticated' | 'no_active_org' | 'not_a_member' | 'invalid_input' | 'update_failed'
    }

export async function saveAuftraegeColumnPreferences(
  input: AuftraegeColumnPreferencesValues
): Promise<SaveAuftraegeColumnPreferencesResult> {
  const auth = await authenticateAndAuthorize()
  if (!auth.success) {
    if (
      auth.error === 'not_authenticated' ||
      auth.error === 'no_active_org' ||
      auth.error === 'not_a_member'
    ) {
      return { success: false, error: auth.error }
    }

    return { success: false, error: 'update_failed' }
  }

  const parsed = auftraegeColumnPreferencesSchema.safeParse(input)
  if (!parsed.success) {
    return { success: false, error: 'invalid_input' }
  }

  const { orgId, userId } = auth.context
  const admin = createSupabaseAdminClient()
  const currentPreferences = await getCachedOrganizationUserPreferences(orgId, userId)
  const nextVisibleColumns = parsed.data.visibleColumns
  const currentVisibleColumns = getAuftraegePreferencesFromJson(currentPreferences.preferences)

  const hasChanges =
    currentVisibleColumns.length !== nextVisibleColumns.length ||
    currentVisibleColumns.some((column, index) => column !== nextVisibleColumns[index])

  if (!hasChanges) {
    return { success: true, visibleColumns: nextVisibleColumns }
  }

  const { error } = await admin.from('organization_user_preferences').upsert(
    {
      organization_id: orgId,
      user_id: userId,
      preferences: buildAuftraegePreferencesJson(
        nextVisibleColumns,
        currentPreferences.preferences
      ),
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'organization_id,user_id',
    }
  )

  if (error) {
    console.error('Error saving Auftraege column preferences:', error)
    return { success: false, error: 'update_failed' }
  }

  updateTag(CACHE_TAGS.organizationUserPreferences(orgId, userId))

  return {
    success: true,
    visibleColumns: nextVisibleColumns,
  }
}
