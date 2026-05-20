'use server'

import { cookies } from 'next/headers'
import { updateTag } from 'next/cache'

import {
  CACHE_TAGS,
  getAuthenticatedUser,
  getCachedOrganizationSettings,
} from '@/lib/data/cached'
import { resolveActiveOrgId } from '@/lib/org/cookies'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getLocalDayEnd, getLocalDayStart } from '@/lib/time-tracking/day-utils'
import { getEffectiveTimeEntries } from '@/lib/time-tracking/effective-entries'
import { deriveCurrentClockState } from '@/lib/time-tracking/helpers'
import {
  appendBreakPolicyHistory,
  buildBreakPolicyHistoryEntry,
  timeTrackingSettingsSchema,
  type TimeTrackingSettingsValues,
} from '@/lib/time-tracking/settings'
import { toTimeEntries, type TimeEntry } from '@/lib/time-tracking/types'

type MemberRow = {
  user_id: string
}

export type UpdateTimeTrackingSettingsResult =
  | {
      success: true
      breakMode: 'manual' | 'automatic'
      autoBreakThresholdMinutes: number
      autoBreakDurationMinutes: number
    }
  | {
      success: false
      error:
        | 'not_authenticated'
        | 'org_not_found'
        | 'not_authorized'
        | 'invalid_input'
        | 'no_changes'
        | 'update_failed'
    }

function getJobIdBeforeCurrentBreak(entries: TimeEntry[]): string | null {
  const effectiveEntries = getEffectiveTimeEntries(entries)
  let activeJobId: string | null = null
  let jobIdBeforeCurrentBreak: string | null = null

  for (const entry of effectiveEntries) {
    switch (entry.entryType) {
      case 'clock_in':
      case 'break_end':
        activeJobId = entry.jobId ?? null
        break
      case 'break_start':
        jobIdBeforeCurrentBreak = activeJobId
        activeJobId = null
        break
      case 'clock_out':
        activeJobId = null
        break
    }
  }

  return jobIdBeforeCurrentBreak
}

async function reconcileOpenBreakSessionsForOrg(
  organizationId: string
): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { data: members, error: membersError } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)

  if (membersError) {
    console.error('Error fetching organization members for break reconciliation:', membersError)
    throw membersError
  }

  const userIds = Array.from(
    new Set((members ?? []).map((member: MemberRow) => member.user_id))
  )

  if (userIds.length === 0) {
    return
  }

  const now = new Date()
  const dayStart = getLocalDayStart(now).toISOString()
  const dayEnd = getLocalDayEnd(now).toISOString()

  const { data: timeEntryRows, error: timeEntriesError } = await admin
    .from('time_entries')
    .select('*')
    .eq('organization_id', organizationId)
    .in('user_id', userIds)
    .gte('timestamp', dayStart)
    .lte('timestamp', dayEnd)
    .order('timestamp', { ascending: true })
    .order('created_at', { ascending: true })

  if (timeEntriesError) {
    console.error('Error fetching time entries for break reconciliation:', timeEntriesError)
    throw timeEntriesError
  }

  const entriesByUser = new Map<string, TimeEntry[]>()

  for (const row of timeEntryRows ?? []) {
    const entry = toTimeEntries([row])[0]
    const existingEntries = entriesByUser.get(entry.userId) ?? []
    existingEntries.push(entry)
    entriesByUser.set(entry.userId, existingEntries)
  }

  const usersOnBreak = [...entriesByUser.entries()].filter(([, entries]) => {
    return deriveCurrentClockState(entries).status === 'on_break'
  })

  for (const [userId, entries] of usersOnBreak) {
    const jobIdBeforeBreak = getJobIdBeforeCurrentBreak(entries)

    const { error: insertError } = await admin.from('time_entries').insert({
      user_id: userId,
      organization_id: organizationId,
      entry_type: 'break_end',
      timestamp: new Date().toISOString(),
      is_manual: false,
      status: 'approved',
      job_id: jobIdBeforeBreak,
    })

    if (insertError) {
      console.error('Error closing open break during settings update:', insertError)
      throw insertError
    }
  }
}

async function invalidateOrganizationSettingsCaches(
  organizationId: string
): Promise<void> {
  const admin = createSupabaseAdminClient()
  const { data: members, error } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)

  if (error) {
    console.error('Error fetching members for settings cache invalidation:', error)
  }

  updateTag(CACHE_TAGS.organizationSettings(organizationId))

  const memberIds = Array.from(
    new Set((members ?? []).map((member: MemberRow) => member.user_id))
  )

  for (const memberId of memberIds) {
    updateTag(CACHE_TAGS.memberships(memberId))
    updateTag(CACHE_TAGS.organizationUserPreferences(organizationId, memberId))
  }
}

export async function updateTimeTrackingSettings(
  input: TimeTrackingSettingsValues
): Promise<UpdateTimeTrackingSettingsResult> {
  const user = await getAuthenticatedUser()

  if (!user) {
    return { success: false, error: 'not_authenticated' }
  }

  const parsed = timeTrackingSettingsSchema.safeParse(input)

  if (!parsed.success) {
    return { success: false, error: 'invalid_input' }
  }

  const cookieStore = await cookies()
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id)

  if (!activeOrgId) {
    return { success: false, error: 'org_not_found' }
  }

  const admin = createSupabaseAdminClient()
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('id, admin_id')
    .eq('id', activeOrgId)
    .single()

  if (organizationError || !organization) {
    return { success: false, error: 'org_not_found' }
  }

  if (organization.admin_id !== user.id) {
    return { success: false, error: 'not_authorized' }
  }

  const currentSettings = await getCachedOrganizationSettings(activeOrgId)
  const nextValues = parsed.data

  const hasChanges =
    currentSettings.breakMode !== nextValues.breakMode ||
    currentSettings.autoBreakThresholdMinutes !== nextValues.autoBreakThresholdMinutes ||
    currentSettings.autoBreakDurationMinutes !== nextValues.autoBreakDurationMinutes

  if (!hasChanges) {
    return { success: false, error: 'no_changes' }
  }

  try {
    await reconcileOpenBreakSessionsForOrg(activeOrgId)

    const nextHistory = appendBreakPolicyHistory(
      currentSettings.breakPolicyHistory,
      buildBreakPolicyHistoryEntry({
        breakMode: nextValues.breakMode,
        autoBreakThresholdMinutes: nextValues.autoBreakThresholdMinutes,
        autoBreakDurationMinutes: nextValues.autoBreakDurationMinutes,
      })
    )

    const { error: updateError } = await admin
      .from('organization_settings')
      .update({
        break_mode: nextValues.breakMode,
        auto_break_threshold_minutes: nextValues.autoBreakThresholdMinutes,
        auto_break_duration_minutes: nextValues.autoBreakDurationMinutes,
        break_policy_history: nextHistory,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', activeOrgId)

    if (updateError) {
      console.error('Error updating time tracking settings:', updateError)
      return { success: false, error: 'update_failed' }
    }

    await invalidateOrganizationSettingsCaches(activeOrgId)

    return {
      success: true,
      breakMode: nextValues.breakMode,
      autoBreakThresholdMinutes: nextValues.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: nextValues.autoBreakDurationMinutes,
    }
  } catch (error) {
    console.error('Unexpected error updating time tracking settings:', error)
    return { success: false, error: 'update_failed' }
  }
}
