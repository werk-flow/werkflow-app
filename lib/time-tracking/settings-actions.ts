'use server';

import { updateTag } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { CACHE_TAGS } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { Tables } from '@/lib/supabase/database.types';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { getLocalDayEnd, getLocalDayStart } from '@/lib/date-time/berlin';
import { getEffectiveTimeEntries } from '@/lib/time-tracking/effective-entries';
import { deriveCurrentClockState } from '@/lib/time-tracking/helpers';
import {
  appendBreakPolicyHistory,
  breakStepOf,
  buildBreakPolicyHistoryEntry,
  getDefaultTimeTrackingSettings,
  normalizeTimeTrackingSettings,
  parseBreakPolicyHistory,
  sameBreakPolicy,
  type BreakPolicyValues,
  type OrganizationTimeTrackingSettings,
} from '@/lib/time-tracking/settings';
import {
  breakPolicyValuesOf,
  timeTrackingSettingsSchema,
  type TimeTrackingSettingsValues,
} from '@/lib/time-tracking/break-rule-form';
import { toTimeEntries, type TimeEntry } from '@/lib/time-tracking/types';

export type UpdateTimeTrackingSettingsResult = ActionResult<
  { policy: BreakPolicyValues },
  'not_authenticated' | 'org_not_found' | 'not_authorized' | 'invalid_input' | 'no_changes' | 'update_failed'
>;

/** The open break's start entry, the latest break start among the effective entries. */
function currentBreakStartId(entries: TimeEntry[]): string | null {
  return getEffectiveTimeEntries(entries).findLast((entry) => entry.entryType === 'break_start')?.id ?? null;
}

/**
 * A break to end: the function ends it only while its start is still the
 * person's latest entry, so a transition that ended it in between wins, and
 * reads the job it resumes itself, under lock.
 */
type OpenBreakEnd = { user_id: string; break_start_id: string | null };

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
    .map(([userId, entries]) => ({ user_id: userId, break_start_id: currentBreakStartId(entries) }));
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

type StoredSettingsRow = Pick<
  Tables<'organization_settings'>,
  | 'break_mode'
  | 'auto_break_threshold_minutes'
  | 'auto_break_duration_minutes'
  | 'auto_break_second_threshold_minutes'
  | 'auto_break_second_duration_minutes'
  | 'break_policy_history'
>;

/** The organization's stored settings, or the defaults when it has no settings row yet. */
function storedTimeTrackingSettings(
  organizationId: string,
  row: StoredSettingsRow | null,
): OrganizationTimeTrackingSettings {
  return row
    ? normalizeTimeTrackingSettings({
        organizationId,
        breakMode: row.break_mode,
        autoBreakThresholdMinutes: row.auto_break_threshold_minutes,
        autoBreakDurationMinutes: row.auto_break_duration_minutes,
        secondStep: breakStepOf(
          row.auto_break_second_threshold_minutes,
          row.auto_break_second_duration_minutes,
        ),
        breakPolicyHistory: parseBreakPolicyHistory(row.break_policy_history),
      })
    : getDefaultTimeTrackingSettings(organizationId);
}

export async function updateTimeTrackingSettings(
  input: TimeTrackingSettingsValues,
): Promise<UpdateTimeTrackingSettingsResult> {
  const auth = await resolveActionContext();
  if (!auth.success) {
    return { success: false, error: auth.error === 'not_authenticated' ? auth.error : 'org_not_found' };
  }
  const { userId, orgId: activeOrgId } = auth.context;

  const parsed = timeTrackingSettingsSchema.safeParse(input);

  if (!parsed.success) {
    return { success: false, error: 'invalid_input' };
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

  if (organization.admin_id !== userId) {
    return { success: false, error: 'not_authorized' };
  }

  // A fresh read, not the cached settings: the history is appended to and
  // written back, so a stale or failed read would drop recorded policy changes.
  const { data: currentRow, error: currentError } = await admin
    .from('organization_settings')
    .select(
      'break_mode, auto_break_threshold_minutes, auto_break_duration_minutes, auto_break_second_threshold_minutes, auto_break_second_duration_minutes, break_policy_history',
    )
    .eq('organization_id', activeOrgId)
    .maybeSingle();
  if (currentError) {
    logError('Error reading time tracking settings', currentError);
    return { success: false, error: 'update_failed' };
  }
  const currentSettings = storedTimeTrackingSettings(activeOrgId, currentRow);
  const nextValues = breakPolicyValuesOf(parsed.data);

  if (sameBreakPolicy(currentSettings, nextValues)) {
    return { success: false, error: 'no_changes' };
  }

  try {
    const breakEnds = await readOpenBreakEnds(activeOrgId);

    const nextHistory = appendBreakPolicyHistory(currentSettings, buildBreakPolicyHistoryEntry(nextValues));

    // One transaction: the function re-checks the admin and the settings it
    // was read from under lock, then writes the settings and ends every open
    // break, or refuses and changes nothing.
    const { error: updateError } = await admin.rpc(
      'update_time_tracking_settings',
      rpcArgs('update_time_tracking_settings', {
        p_actor_id: userId,
        p_organization_id: activeOrgId,
        p_expected_settings: currentRow,
        p_break_mode: nextValues.breakMode,
        p_auto_break_threshold_minutes: nextValues.autoBreakThresholdMinutes,
        p_auto_break_duration_minutes: nextValues.autoBreakDurationMinutes,
        p_auto_break_second_threshold_minutes: nextValues.secondStep?.thresholdMinutes ?? null,
        p_auto_break_second_duration_minutes: nextValues.secondStep?.durationMinutes ?? null,
        p_break_policy_history: nextHistory,
        p_break_ends: breakEnds,
      }),
    );

    if (updateError) {
      return settingsWriteFailure(updateError);
    }

    // The one cached reader of these columns; break computations read it.
    updateTag(CACHE_TAGS.organizationSettings(activeOrgId));

    return { success: true, policy: nextValues };
  } catch (error) {
    logError('Unexpected error updating time tracking settings:', error);
    return { success: false, error: 'update_failed' };
  }
}
