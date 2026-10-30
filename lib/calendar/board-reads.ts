import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';

// The board context reader's reads and their failure log; the Server Action in board-actions.ts
// authorizes the caller before it calls any of them.

/** Every failing branch names its read and its code, so a board that does not load is diagnosable from the log. */
export function boardLoadFailed(read: string, code: string | null | undefined): ActionFailure<'load_failed'> {
  logReadFailure(`Calendar board read failed: ${read}`, { code: code ?? 'unknown' });
  return { success: false, error: 'load_failed' };
}

export type BoardRecord = Pick<
  Tables<'employee_records'>,
  'id' | 'user_id' | 'first_name' | 'last_name' | 'entry_date' | 'exit_date'
>;
export type BoardTeam = { id: string; name: string };

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
      .select('id, user_id, first_name, last_name, entry_date, exit_date')
      .eq('organization_id', input.orgId)
      .or(`exit_date.is.null,exit_date.gte.${dates.from}`)
      .or(`entry_date.is.null,entry_date.lte.${dates.to}`)
      .order('last_name')
      .order('first_name')
      .order('id');
    return (input.isManagerOrAbove ? recordsQuery : recordsQuery.eq('user_id', input.userId)).range(from, to);
  }, LIST_ROW_CAP);
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
