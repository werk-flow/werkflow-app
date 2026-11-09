import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { accessEndDatesByRecord, type AvailabilityRecord } from '@/lib/planning/availability';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { CalendarBoardRowlessAssignee } from './board';

// The board context reader's reads and their failure log; the Server Action in board-actions.ts
// authorizes the caller before it calls any of them.

/** Every failing branch names its read and its code, so a board that does not load is diagnosable from the log. */
export function boardLoadFailed(read: string, code: string | null | undefined): ActionFailure<'load_failed'> {
  logReadFailure(`Calendar board read failed: ${read}`, { code: code ?? 'unknown' });
  return { success: false, error: 'load_failed' };
}

export type BoardRecord = Pick<Tables<'employee_records'>, 'user_id' | 'first_name' | 'last_name'> &
  AvailabilityRecord;
export type BoardTeam = { id: string; name: string };

type ProfileName = Pick<Tables<'profiles'>, 'first_name' | 'last_name'>;

/** A person's board name: the profile's name for a login, the record's otherwise. */
export function boardDisplayName(record: BoardRecord, profile: ProfileName | undefined): string {
  return (
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    [record.first_name, record.last_name].filter(Boolean).join(' ') ||
    'Unbenannt'
  );
}

// The record columns every board person carries, with the access lifecycle that ends app access.
const BOARD_RECORD_SELECT =
  'id, user_id, first_name, last_name, entry_date, exit_date, personnel_access_lifecycles!personnel_access_lifecycles_employee_org_fkey(state, state_effective_at, scheduled_state, scheduled_for)';

/**
 * The board's rows: employee records employed inside the window; an employee gets their own
 * record only. Read in pages: one response holds at most 1,000 records.
 */
export function loadBoardRecords(input: {
  admin: AdminClient;
  orgId: string;
  userId: string;
  isManagerOrAbove: boolean;
  dates: { from: string; to: string };
}): Promise<{ data: BoardRecord[]; error: { message: string; code: string } | null }> {
  const { admin, dates } = input;
  return readCompleteRows((from, to) => {
    const recordsQuery = admin
      .from('employee_records')
      .select(BOARD_RECORD_SELECT)
      .eq('organization_id', input.orgId)
      .or(`exit_date.is.null,exit_date.gte.${dates.from}`)
      .or(`entry_date.is.null,entry_date.lte.${dates.to}`)
      .order('last_name')
      .order('first_name')
      .order('id');
    return (input.isManagerOrAbove ? recordsQuery : recordsQuery.eq('user_id', input.userId)).range(from, to);
  }, LIST_ROW_CAP);
}

/** The team memberships valid on the window's first day, newest first, for `loadTeamByRecord`. */
export function loadTeamMemberships(
  admin: AdminClient,
  orgId: string,
  recordIds: readonly string[],
  windowStart: string,
): Promise<{
  data: Array<{ employee_record_id: string; team_id: string }>;
  error: { message: string; code?: string } | null;
}> {
  if (recordIds.length === 0) return Promise.resolve({ data: [], error: null });
  return readInBatches(recordIds, (ids) =>
    admin
      .from('team_memberships')
      .select('employee_record_id, team_id')
      .eq('organization_id', orgId)
      .in('employee_record_id', [...ids])
      .lte('valid_from', windowStart)
      .or(`valid_until.is.null,valid_until.gte.${windowStart}`)
      .order('valid_from', { ascending: false }),
  );
}

/**
 * Each record's team. The membership valid on the window's first day wins; a person keeps one
 * row for the whole window.
 */
export async function loadTeamByRecord(
  admin: AdminClient,
  orgId: string,
  memberships: Array<{ employee_record_id: string; team_id: string }>,
): Promise<{ success: true; teams: Map<string, BoardTeam> } | ActionFailure<'load_failed'>> {
  const teamIds = [...new Set(memberships.map((membership) => membership.team_id))];
  const teamsResult = teamIds.length
    ? await readInBatches(teamIds, (ids) =>
        admin
          .from('teams')
          .select('id, name')
          .eq('organization_id', orgId)
          .is('dissolved_at', null)
          .in('id', [...ids]),
      )
    : { data: [], error: null };
  if (teamsResult.error) return boardLoadFailed('teams', teamsResult.error.code);
  const teams = new Map((teamsResult.data ?? []).map((team) => [team.id, team]));
  const teamByRecord = new Map<string, BoardTeam>();
  for (const membership of memberships) {
    const team = teams.get(membership.team_id);
    if (!team || teamByRecord.has(membership.employee_record_id)) continue;
    teamByRecord.set(membership.employee_record_id, { id: team.id, name: team.name });
  }
  return { success: true, teams: teamByRecord };
}

/**
 * The people the window's scheduled visits name without a row: employed
 * outside the whole window, so the records read skipped them. Read only when
 * such a person exists, which keeps the common board at its requests.
 */
export async function loadRowlessAssignees(
  admin: AdminClient,
  orgId: string,
  employeeRecordIds: readonly string[],
): Promise<{ success: true; assignees: CalendarBoardRowlessAssignee[] } | ActionFailure<'load_failed'>> {
  if (employeeRecordIds.length === 0) return { success: true, assignees: [] };
  const records = await readInBatches(employeeRecordIds, (ids) =>
    admin
      .from('employee_records')
      .select(BOARD_RECORD_SELECT)
      .eq('organization_id', orgId)
      .in('id', [...ids]),
  );
  if (records.error) return boardLoadFailed('rowless assignees', records.error.code);
  const userIds = records.data.flatMap((record) => (record.user_id ? [record.user_id] : []));
  const profiles = await readInBatches(userIds, (ids) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...ids]),
  );
  if (profiles.error) return boardLoadFailed('rowless assignee profiles', profiles.error.code);
  const profileById = new Map(profiles.data.map((profile) => [profile.id, profile]));
  const accessEndByRecord = accessEndDatesByRecord(records.data);
  return {
    success: true,
    assignees: records.data.map((record) => ({
      employeeRecordId: record.id,
      userId: record.user_id,
      displayName: boardDisplayName(record, record.user_id ? profileById.get(record.user_id) : undefined),
      entryDate: record.entry_date,
      exitDate: record.exit_date,
      accessEndDate: accessEndByRecord.get(record.id) ?? null,
    })),
  };
}
