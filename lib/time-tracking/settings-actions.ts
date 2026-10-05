'use server';

import { cookies } from 'next/headers';
import { updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { CACHE_TAGS, getAuthenticatedUser } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { resolveActiveOrgId } from '@/lib/org/cookies';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { getLocalDayEnd, getLocalDayStart } from '@/lib/time-tracking/day-utils';
import { getEffectiveTimeEntries } from '@/lib/time-tracking/effective-entries';
import { deriveCurrentClockState } from '@/lib/time-tracking/helpers';
import {
  appendBreakPolicyHistory,
  buildBreakPolicyHistoryEntry,
  getDefaultTimeTrackingSettings,
  normalizeTimeTrackingSettings,
  parseBreakPolicyHistory,
  timeTrackingSettingsSchema,
  type TimeTrackingSettingsValues,
} from '@/lib/time-tracking/settings';
import { toTimeEntries, type TimeEntry } from '@/lib/time-tracking/types';

export type UpdateTimeTrackingSettingsResult = ActionResult<
  {
    breakMode: 'manual' | 'automatic';
    autoBreakThresholdMinutes: number;
    autoBreakDurationMinutes: number;
  },
  'not_authenticated' | 'org_not_found' | 'not_authorized' | 'invalid_input' | 'no_changes' | 'update_failed'
>;

function getJobIdBeforeCurrentBreak(entries: TimeEntry[]): string | null {
  const effectiveEntries = getEffectiveTimeEntries(entries);
  let activeJobId: string | null = null;
  let jobIdBeforeCurrentBreak: string | null = null;

  for (const entry of effectiveEntries) {
    switch (entry.entryType) {
      case 'clock_in':
      case 'break_end':
        activeJobId = entry.jobId ?? null;
        break;
      case 'break_start':
        jobIdBeforeCurrentBreak = activeJobId;
        activeJobId = null;
        break;
      case 'clock_out':
        activeJobId = null;
        break;
    }
  }

  return jobIdBeforeCurrentBreak;
}

type OpenBreakEnd = { user_id: string; job_id: string | null };

/** The break end of every member on a break today, with the job the break resumes. */
async function readOpenBreakEnds(organizationId: string): Promise<OpenBreakEnd[]> {
  const admin = createSupabaseAdminClient();
  // Complete paged reads: a day of a large organization exceeds one 1,000-row response.
  const { data: members, error: membersError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .order('user_id')
        .range(from, to),
    LIST_ROW_CAP,
  );

  if (membersError) {
    logError('Error fetching organization members for break reconciliation:', membersError);
    throw membersError;
  }

  const memberIds = new Set(members.map((member) => member.user_id));

  if (memberIds.size === 0) {
    return [];
  }

  const now = new Date();
  const dayStart = getLocalDayStart(now).toISOString();
  const dayEnd = getLocalDayEnd(now).toISOString();

  const { data: timeEntryRows, error: timeEntriesError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_entries')
        .select('*')
        .eq('organization_id', organizationId)
        .gte('timestamp', dayStart)
        .lte('timestamp', dayEnd)
        .order('timestamp', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );

  if (timeEntriesError) {
    logError('Error fetching time entries for break reconciliation:', timeEntriesError);
    throw timeEntriesError;
  }

  const entriesByUser = new Map<string, TimeEntry[]>();

  for (const row of timeEntryRows) {
    if (!memberIds.has(row.user_id)) continue;
    const [entry] = toTimeEntries([row]);
    if (!entry) continue;
    const existingEntries = entriesByUser.get(entry.userId) ?? [];
    existingEntries.push(entry);
    entriesByUser.set(entry.userId, existingEntries);
  }

  return [...entriesByUser.entries()]
    .filter(([, entries]) => deriveCurrentClockState(entries).status === 'on_break')
    .map(([userId, entries]) => ({ user_id: userId, job_id: getJobIdBeforeCurrentBreak(entries) }));
}

/** The action failure of a refused or failed update_time_tracking_settings call. */
function settingsWriteFailure(error: { message: string }): UpdateTimeTrackingSettingsResult {
  switch (error.message) {
    case 'org_not_found':
    case 'not_authorized':
    case 'invalid_input':
      return { success: false, error: error.message };
    default:
      // settings_changed (a concurrent save), target_not_found (a removed
      // member), a closed period and the refusals of the time-entry triggers.
      logError('Error updating time tracking settings:', error);
      return { success: false, error: 'update_failed' };
  }
}

export async function updateTimeTrackingSettings(
  input: TimeTrackingSettingsValues,
): Promise<UpdateTimeTrackingSettingsResult> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return { success: false, error: 'not_authenticated' };
  }

  const parsed = timeTrackingSettingsSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
  }

  const cookieStore = await cookies();
  const activeOrgId = await resolveActiveOrgId(cookieStore, user.id);

  if (!activeOrgId) {
    return { success: false, error: 'org_not_found' };
  }

  const admin = createSupabaseAdminClient();
  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('id, admin_id')
    .eq('id', activeOrgId)
    .single();

  if (organizationError || !organization) {
    return { success: false, error: 'org_not_found' };
  }

  if (organization.admin_id !== user.id) {
    return { success: false, error: 'not_authorized' };
  }

  // A fresh read, not the cached settings: the history is appended to and
  // written back, so a stale or failed read would drop recorded policy changes.
  const { data: currentRow, error: currentError } = await admin
    .from('organization_settings')
    .select('break_mode, auto_break_threshold_minutes, auto_break_duration_minutes, break_policy_history')
    .eq('organization_id', activeOrgId)
    .maybeSingle();
  if (currentError) {
    logError('Error reading time tracking settings', currentError);
    return { success: false, error: 'update_failed' };
  }
  const currentSettings = currentRow
    ? normalizeTimeTrackingSettings({
        organizationId: activeOrgId,
        breakMode: currentRow.break_mode,
        autoBreakThresholdMinutes: currentRow.auto_break_threshold_minutes,
        autoBreakDurationMinutes: currentRow.auto_break_duration_minutes,
        breakPolicyHistory: parseBreakPolicyHistory(currentRow.break_policy_history),
      })
    : getDefaultTimeTrackingSettings(activeOrgId);
  const nextValues = parsed.data;

  const hasChanges =
    currentSettings.breakMode !== nextValues.breakMode ||
    currentSettings.autoBreakThresholdMinutes !== nextValues.autoBreakThresholdMinutes ||
    currentSettings.autoBreakDurationMinutes !== nextValues.autoBreakDurationMinutes;

  if (!hasChanges) {
    return { success: false, error: 'no_changes' };
  }

  try {
    const breakEnds = await readOpenBreakEnds(activeOrgId);

    const nextHistory = appendBreakPolicyHistory(
      currentSettings.breakPolicyHistory,
      buildBreakPolicyHistoryEntry({
        breakMode: nextValues.breakMode,
        autoBreakThresholdMinutes: nextValues.autoBreakThresholdMinutes,
        autoBreakDurationMinutes: nextValues.autoBreakDurationMinutes,
      }),
    );

    // One transaction: the function re-checks the admin and the settings it
    // was read from under lock, then writes the settings and ends every open
    // break, or refuses and changes nothing.
    const { error: updateError } = await admin.rpc(
      'update_time_tracking_settings',
      rpcArgs('update_time_tracking_settings', {
        p_actor_id: user.id,
        p_organization_id: activeOrgId,
        p_expected_settings: currentRow,
        p_break_mode: nextValues.breakMode,
        p_auto_break_threshold_minutes: nextValues.autoBreakThresholdMinutes,
        p_auto_break_duration_minutes: nextValues.autoBreakDurationMinutes,
        p_break_policy_history: nextHistory,
        p_break_ends: breakEnds,
      }),
    );

    if (updateError) {
      return settingsWriteFailure(updateError);
    }

    // The one cached reader of these columns; break computations read it.
    updateTag(CACHE_TAGS.organizationSettings(activeOrgId));

    return {
      success: true,
      breakMode: nextValues.breakMode,
      autoBreakThresholdMinutes: nextValues.autoBreakThresholdMinutes,
      autoBreakDurationMinutes: nextValues.autoBreakDurationMinutes,
    };
  } catch (error) {
    logError('Unexpected error updating time tracking settings:', error);
    return { success: false, error: 'update_failed' };
  }
}
