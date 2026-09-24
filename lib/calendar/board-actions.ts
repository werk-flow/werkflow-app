'use server';

import { z } from 'zod';
import { parseIsoDateRange } from '@/lib/calendar/date-range';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { loadOccurrenceDispatchStates } from '@/lib/dispatch/server';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { OrgRole } from '@/lib/jobs/types';
import { addLocalDays, resolveBerlinWallTime } from '@/lib/planning/date-time';
import { loadDailyTargetsByRecord } from '@/lib/planning/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readAllRows, readInBatches } from '@/lib/supabase/query-batches';
import type { CalendarBoardContext, CalendarBoardDay, CalendarBoardRow } from './board';

/**
 * The board context reader (P1-24a): rows, daily targets, dispatch states and
 * material demand for one date window, beside the calendar window GET. The
 * client reaches it through GET /api/calendar-board. Managers see every
 * active employee record; an employee sees exactly their own record and their
 * own targets, and never another person's capacity, absence or dispatch.
 */
export type CalendarBoardInput = {
  organizationId: string;
  fromDate: string;
  toDate: string;
};

export type CalendarBoardResult =
  | ({ success: true } & CalendarBoardContext)
  | { success: false; error: string };

const OCCURRENCE_ROW_CAP = 2000;
const occurrenceRowSchema = z.array(z.object({ id: z.string(), job_id: z.string().nullable() }));

function isoDatesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addLocalDays(date, 1)) dates.push(date);
  return dates;
}

export async function getCalendarBoardContext(input: CalendarBoardInput): Promise<CalendarBoardResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  if (!input || typeof input !== 'object') return { success: false, error: 'invalid_input' };
  const dates = parseIsoDateRange({ from: input.fromDate, to: input.toDate });
  if (!dates || typeof input.organizationId !== 'string') return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (auth.context.orgId !== input.organizationId) return { success: false, error: 'organization_changed' };
  const { orgId, userId, isManagerOrAbove } = auth.context;
  const admin = createSupabaseAdminClient();

  // Rows: employee records employed inside the window; an employee gets their own record only.
  let recordsQuery = admin
    .from('employee_records')
    .select('id, user_id, first_name, last_name, entry_date, exit_date')
    .eq('organization_id', orgId)
    .or(`exit_date.is.null,exit_date.gte.${dates.from}`)
    .or(`entry_date.is.null,entry_date.lte.${dates.to}`)
    .order('last_name')
    .order('first_name')
    .order('id');
  if (!isManagerOrAbove) recordsQuery = recordsQuery.eq('user_id', userId);
  const recordsResult = await recordsQuery;
  if (recordsResult.error) return { success: false, error: 'load_failed' };
  const records = recordsResult.data ?? [];
  const recordIds = records.map((record) => record.id);
  const userIds = records.flatMap((record) => (record.user_id ? [record.user_id] : []));

  const [profilesResult, membersResult, membershipsResult, targets] = await Promise.all([
    userIds.length
      ? readInBatches(userIds, (ids) => admin.from('profiles').select('id, first_name, last_name').in('id', [...ids]))
      : { data: [], error: null },
    userIds.length
      ? readInBatches(userIds, (ids) =>
          admin.from('organization_members').select('user_id, role').eq('organization_id', orgId).in('user_id', [...ids]))
      : { data: [], error: null },
    recordIds.length
      ? readInBatches(recordIds, (ids) =>
          admin
            .from('team_memberships')
            .select('employee_record_id, team_id')
            .eq('organization_id', orgId)
            .in('employee_record_id', [...ids])
            .lte('valid_from', dates.from)
            .or(`valid_until.is.null,valid_until.gte.${dates.from}`)
            .order('valid_from', { ascending: false }))
      : { data: [], error: null },
    loadDailyTargetsByRecord({ admin, orgId, employeeRecordIds: recordIds, dates: isoDatesBetween(dates.from, dates.to) }),
  ]);
  if (profilesResult.error || membersResult.error || membershipsResult.error || !targets) {
    return { success: false, error: 'load_failed' };
  }
  const memberships = membershipsResult.data ?? [];
  const teamIds = [...new Set(memberships.map((membership) => membership.team_id))];
  const teamsResult = teamIds.length
    ? await readInBatches(teamIds, (ids) =>
        admin.from('teams').select('id, name').eq('organization_id', orgId).is('dissolved_at', null).in('id', [...ids]))
    : { data: [], error: null };
  if (teamsResult.error) return { success: false, error: 'load_failed' };
  const teams = new Map((teamsResult.data ?? []).map((team) => [team.id, team]));
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const roles = new Map((membersResult.data ?? []).map((member) => [member.user_id, member.role as OrgRole]));
  // The membership valid on the window's first day wins; a person keeps one row for the whole window.
  const teamByRecord = new Map<string, { id: string; name: string }>();
  for (const membership of memberships) {
    const team = teams.get(membership.team_id);
    if (!team || teamByRecord.has(membership.employee_record_id)) continue;
    teamByRecord.set(membership.employee_record_id, { id: team.id, name: team.name });
  }

  const rows: CalendarBoardRow[] = records.map((record) => {
    const profile = record.user_id ? profiles.get(record.user_id) : undefined;
    const role = record.user_id ? roles.get(record.user_id) ?? null : null;
    const team = teamByRecord.get(record.id) ?? null;
    return {
      employeeRecordId: record.id,
      userId: record.user_id,
      displayName:
        [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
        [record.first_name, record.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
      role,
      hasLogin: role !== null,
      teamId: team?.id ?? null,
      teamName: team?.name ?? null,
      entryDate: record.entry_date,
      exitDate: record.exit_date,
    };
  });

  const pendingByRecordDate = new Set(
    targets.pendingVacation.flatMap((request) =>
      isoDatesBetween(request.start_date, request.end_date).map((date) => `${request.employee_record_id}:${date}`)),
  );
  const days: CalendarBoardDay[] = [];
  for (const [key, target] of targets.targetByEmployeeDate) {
    const separator = key.indexOf(':');
    const employeeRecordId = key.slice(0, separator);
    days.push({
      employeeRecordId,
      date: target.date,
      targetMinutes: target.targetMinutes,
      baseTargetMinutes: target.baseTargetMinutes,
      reason: target.isClosureDay ? 'closure' : target.isHoliday ? 'holiday' : target.baseTargetMinutes === 0 ? 'no_work_day' : 'working',
      label: target.closureLabel ?? target.holidayName,
      absence: target.absence ? { type: target.absence.type, portion: target.absence.portion } : null,
      pendingVacation: pendingByRecordDate.has(key),
    });
  }

  // Occurrences of the window (same filter as the calendar window read) for
  // dispatch states and material demand; an employee sees only their own.
  const fromInstant = resolveBerlinWallTime(`${dates.from}T00:00`);
  const toInstant = resolveBerlinWallTime(`${addLocalDays(dates.to, 1)}T00:00`);
  if (!fromInstant || !toInstant) return { success: false, error: 'invalid_input' };
  const ownRecordId = isManagerOrAbove ? null : (recordIds[0] ?? null);
  if (!isManagerOrAbove && !ownRecordId) {
    return { success: true, rows, days, dispatch: [], materialDemandJobIds: [] };
  }
  // The employee's inner-joined alias carries the own-assignment filter; the
  // select is assembled as a string, so the rows are validated after the read.
  const occurrenceSelect: string = ownRecordId
    ? 'id, job_id, own:planning_occurrence_assignments!inner(employee_record_id)'
    : 'id, job_id';
  const occurrenceQuery = () => {
    let query = admin
      .from('planning_occurrences')
      .select(occurrenceSelect)
      .eq('organization_id', orgId)
      .eq('status', 'scheduled')
      .or(
        `and(start_at.lt.${toInstant.instant.toISOString()},end_at.gt.${fromInstant.instant.toISOString()}),and(start_date.lte.${dates.to},end_date_exclusive.gt.${dates.from})`,
      );
    if (ownRecordId) query = query.eq('own.employee_record_id', ownRecordId);
    return query.order('id');
  };
  const occurrences = await readAllRows<unknown, { message: string }>(
    (from, to) => occurrenceQuery().range(from, to),
    { cap: OCCURRENCE_ROW_CAP },
  );
  if (occurrences.error || occurrences.overflow) return { success: false, error: 'load_failed' };
  const parsedRows = occurrenceRowSchema.safeParse(occurrences.data);
  if (!parsedRows.success) return { success: false, error: 'load_failed' };
  const occurrenceRows = parsedRows.data;
  const jobIds = [...new Set(occurrenceRows.flatMap((row) => (row.job_id ? [row.job_id] : [])))];

  const [dispatch, materialResult] = await Promise.all([
    loadOccurrenceDispatchStates(admin, orgId, occurrenceRows.map((row) => row.id)),
    jobIds.length
      ? readInBatches(jobIds, (ids) =>
          admin.from('job_material_lines').select('job_id').eq('organization_id', orgId).in('job_id', [...ids]).gt('planned_quantity', 0))
      : { data: [], error: null },
  ]);
  if (!dispatch || materialResult.error) return { success: false, error: 'load_failed' };

  return {
    success: true,
    rows,
    days,
    dispatch: ownRecordId ? dispatch.filter((entry) => entry.employeeRecordId === ownRecordId) : dispatch,
    materialDemandJobIds: [...new Set((materialResult.data ?? []).flatMap((line) => (line.job_id ? [line.job_id] : [])))],
  };
}
