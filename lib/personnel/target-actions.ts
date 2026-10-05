'use server';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { getBusinessTodayIso, toEmploymentCondition } from '@/lib/personnel/types';
import { getBusinessWeekDates, toWorkSchedule } from '@/lib/personnel/schedule';
import { resolveDailyTargets, type DailyTarget } from '@/lib/personnel/targets';
import { loadApprovedVacationSpansByRecord } from '@/lib/vacation/server';
import { loadActiveSicknessSpansByRecord } from '@/lib/sickness/server';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import type { ActionFailure } from '@/lib/action-result';

const weeklyTargetsInputSchema = z.object({ userId: uuidSchema });

// Server-side assembly of the P1-04 target contract. Targets are computed,
// never stored; employees may only request their own targets, managers any
// member of the active organization (mirrors the time-entry read rules).

export type WeeklyTargetsResult = { success: true; targets: DailyTarget[] } | ActionFailure;

/**
 * The current Berlin business week's daily targets (Montag–Sonntag) for one
 * user of the active organization.
 */
export async function getWeeklyTargets(rawInput: { userId: string }): Promise<WeeklyTargetsResult> {
  const parsedInput = weeklyTargetsInputSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (input.userId !== userId && !isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const calendarPromise = getCachedOrganizationCalendar(orgId);
    // The record lookup below can return early; without a handler an infra
    // rejection of the calendar fetch would surface as an unhandled rejection.
    // The real await further down still propagates it into this try block.
    // eslint-disable-next-line no-restricted-syntax -- only prevents the unhandled rejection described above; the await below still propagates it
    calendarPromise.catch(() => {});

    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (recordError) {
      logError('Failed to load employee record for targets:', recordError);
      return { success: false, error: 'load_failed' };
    }

    const weekDates = getBusinessWeekDates();
    const [weekStart] = weekDates;
    const weekEnd = weekDates.at(-1);
    if (!weekStart || !weekEnd) return { success: false, error: 'load_failed' };

    if (!record) {
      // No personnel record (should not happen for members): resolve with the
      // labeled default cascade so the surface still shows an honest state.
      const calendar = await calendarPromise;
      return {
        success: true,
        targets: resolveDailyTargets(weekDates, {
          schedules: [],
          conditions: [],
          calendar,
        }),
      };
    }

    const [schedulesResult, conditionsResult, calendar, vacationSpans, sicknessSpans] = await Promise.all([
      admin
        .from('work_schedules')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', record.id),
      admin
        .from('employment_conditions')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', record.id),
      calendarPromise,
      loadApprovedVacationSpansByRecord(orgId, weekStart, weekEnd),
      loadActiveSicknessSpansByRecord(orgId, weekStart, weekEnd, record.id),
    ]);

    if (schedulesResult.error || conditionsResult.error) {
      logError(
        'Failed to load schedule context for targets:',
        schedulesResult.error ?? conditionsResult.error,
      );
      return { success: false, error: 'load_failed' };
    }
    // The span readers log their own failure; a missing span map is not "no absence".
    if (!vacationSpans || !sicknessSpans) return { success: false, error: 'load_failed' };

    return {
      success: true,
      targets: resolveDailyTargets(weekDates, {
        schedules: (schedulesResult.data ?? []).map(toWorkSchedule),
        conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
        calendar,
        // Vacation first: the resolver also prefers vacation attribution on
        // days covered by both span kinds.
        absences: [...(vacationSpans.get(record.id) ?? []), ...(sicknessSpans.get(record.id) ?? [])],
      }),
    };
  } catch (error) {
    logError('Unexpected error in getWeeklyTargets:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type MemberTodayTargetsResult =
  | { success: true; targetsByUserId: Record<string, DailyTarget> }
  | ActionFailure;

/**
 * Today's target for every member with a login in the active organization
 * (manager surfaces: member list progress and detail Tagesfortschritt).
 */
export async function getTodayTargetsForMembers(): Promise<MemberTodayTargetsResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, isManagerOrAbove } = auth.context;

    if (!isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();

    const todayIso = getBusinessTodayIso();
    const [recordsResult, schedulesResult, conditionsResult, calendar, vacationSpans, sicknessSpans] =
      await Promise.all([
        readCompleteRows(
          (from, to) =>
            admin
              .from('employee_records')
              .select('id, user_id')
              .eq('organization_id', orgId)
              .not('user_id', 'is', null)
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
        readCompleteRows(
          (from, to) =>
            admin.from('work_schedules').select('*').eq('organization_id', orgId).order('id').range(from, to),
          LIST_ROW_CAP,
        ),
        readCompleteRows(
          (from, to) =>
            admin
              .from('employment_conditions')
              .select('*')
              .eq('organization_id', orgId)
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
        getCachedOrganizationCalendar(orgId),
        loadApprovedVacationSpansByRecord(orgId, todayIso, todayIso),
        loadActiveSicknessSpansByRecord(orgId, todayIso, todayIso),
      ]);

    if (recordsResult.error || schedulesResult.error || conditionsResult.error) {
      logReadFailure(
        'Failed to load member target context:',
        recordsResult.error ?? schedulesResult.error ?? conditionsResult.error,
      );
      return { success: false, error: 'load_failed' };
    }
    if (!vacationSpans || !sicknessSpans) return { success: false, error: 'load_failed' };

    const schedulesByRecord = new Map<string, ReturnType<typeof toWorkSchedule>[]>();
    for (const row of schedulesResult.data) {
      const schedule = toWorkSchedule(row);
      const list = schedulesByRecord.get(schedule.employeeRecordId) ?? [];
      list.push(schedule);
      schedulesByRecord.set(schedule.employeeRecordId, list);
    }

    const conditionsByRecord = new Map<string, ReturnType<typeof toEmploymentCondition>[]>();
    for (const row of conditionsResult.data) {
      const condition = toEmploymentCondition(row);
      const list = conditionsByRecord.get(condition.employeeRecordId) ?? [];
      list.push(condition);
      conditionsByRecord.set(condition.employeeRecordId, list);
    }

    const targetsByUserId: Record<string, DailyTarget> = {};
    for (const record of recordsResult.data) {
      if (!record.user_id) continue;
      const [target] = resolveDailyTargets([todayIso], {
        schedules: schedulesByRecord.get(record.id) ?? [],
        conditions: conditionsByRecord.get(record.id) ?? [],
        calendar,
        absences: [...(vacationSpans.get(record.id) ?? []), ...(sicknessSpans.get(record.id) ?? [])],
      });
      if (!target) continue;
      targetsByUserId[record.user_id] = target;
    }

    return { success: true, targetsByUserId };
  } catch (error) {
    logError('Unexpected error in getTodayTargetsForMembers:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
