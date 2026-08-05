'use server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import {
  getBusinessTodayIso,
  toEmploymentCondition,
} from '@/lib/personnel/types';
import {
  getBusinessWeekDates,
  toWorkSchedule,
} from '@/lib/personnel/schedule';
import {
  resolveDailyTargets,
  type DailyTarget,
} from '@/lib/personnel/targets';

// Server-side assembly of the P1-04 target contract. Targets are computed,
// never stored; employees may only request their own targets, managers any
// member of the active organization (mirrors the time-entry read rules).

export type WeeklyTargetsResult =
  | { success: true; targets: DailyTarget[] }
  | { success: false; error: string };

/**
 * The current Berlin business week's daily targets (Montag–Sonntag) for one
 * user of the active organization.
 */
export async function getWeeklyTargets(input: {
  userId: string;
}): Promise<WeeklyTargetsResult> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;

    if (input.userId !== userId && !isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const admin = createSupabaseAdminClient();
    const calendarPromise = getCachedOrganizationCalendar(orgId);

    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', input.userId)
      .maybeSingle();

    if (recordError) {
      console.error('Failed to load employee record for targets:', recordError);
      return { success: false, error: 'load_failed' };
    }

    const weekDates = getBusinessWeekDates();

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

    const [schedulesResult, conditionsResult, calendar] = await Promise.all([
      admin
        .from('work_schedules')
        .select('*')
        .eq('employee_record_id', record.id),
      admin
        .from('employment_conditions')
        .select('*')
        .eq('employee_record_id', record.id),
      calendarPromise,
    ]);

    if (schedulesResult.error || conditionsResult.error) {
      console.error(
        'Failed to load schedule context for targets:',
        schedulesResult.error ?? conditionsResult.error
      );
      return { success: false, error: 'load_failed' };
    }

    return {
      success: true,
      targets: resolveDailyTargets(weekDates, {
        schedules: (schedulesResult.data ?? []).map(toWorkSchedule),
        conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
        calendar,
      }),
    };
  } catch (error) {
    console.error('Unexpected error in getWeeklyTargets:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export type MemberTodayTarget = {
  userId: string;
  target: DailyTarget;
};

export type MemberTodayTargetsResult =
  | { success: true; targetsByUserId: Record<string, DailyTarget> }
  | { success: false; error: string };

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

    const [recordsResult, schedulesResult, conditionsResult, calendar] =
      await Promise.all([
        admin
          .from('employee_records')
          .select('id, user_id')
          .eq('organization_id', orgId)
          .not('user_id', 'is', null),
        admin.from('work_schedules').select('*').eq('organization_id', orgId),
        admin
          .from('employment_conditions')
          .select('*')
          .eq('organization_id', orgId),
        getCachedOrganizationCalendar(orgId),
      ]);

    if (recordsResult.error || schedulesResult.error || conditionsResult.error) {
      console.error(
        'Failed to load member target context:',
        recordsResult.error ?? schedulesResult.error ?? conditionsResult.error
      );
      return { success: false, error: 'load_failed' };
    }

    const schedulesByRecord = new Map<string, ReturnType<typeof toWorkSchedule>[]>();
    for (const row of schedulesResult.data ?? []) {
      const schedule = toWorkSchedule(row);
      const list = schedulesByRecord.get(schedule.employeeRecordId) ?? [];
      list.push(schedule);
      schedulesByRecord.set(schedule.employeeRecordId, list);
    }

    const conditionsByRecord = new Map<string, ReturnType<typeof toEmploymentCondition>[]>();
    for (const row of conditionsResult.data ?? []) {
      const condition = toEmploymentCondition(row);
      const list = conditionsByRecord.get(condition.employeeRecordId) ?? [];
      list.push(condition);
      conditionsByRecord.set(condition.employeeRecordId, list);
    }

    const targetsByUserId: Record<string, DailyTarget> = {};
    for (const record of recordsResult.data ?? []) {
      if (!record.user_id) continue;
      const [target] = resolveDailyTargets([getBusinessTodayIso()], {
        schedules: schedulesByRecord.get(record.id) ?? [],
        conditions: conditionsByRecord.get(record.id) ?? [],
        calendar,
      });
      targetsByUserId[record.user_id] = target;
    }

    return { success: true, targetsByUserId };
  } catch (error) {
    console.error('Unexpected error in getTodayTargetsForMembers:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
