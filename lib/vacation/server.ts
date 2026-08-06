import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { toEmploymentCondition } from '@/lib/personnel/types';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import type { ApprovedAbsenceSpan } from '@/lib/personnel/targets';
import type { VacationCountingContext } from './balance';
import { toVacationRequest, type VacationRequest } from './types';

// Server-only shared loaders for the vacation domain. Server actions and the
// target loaders consume these; nothing here performs authorization — callers
// resolve their own authority first.

/**
 * The counting context (schedules, conditions, holiday calendar) for one
 * employee record — the same inputs `resolveDailyTarget` uses, so vacation-day
 * counting can never drift from the target truth.
 */
export async function loadVacationCountingContext(
  organizationId: string,
  employeeRecordId: string
): Promise<VacationCountingContext | null> {
  const admin = createSupabaseAdminClient();
  // organization_id is redundant with the record filter but keeps the
  // service-role read organization-scoped even against a mismatched caller.
  const [schedulesResult, conditionsResult, calendar] = await Promise.all([
    admin
      .from('work_schedules')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('employee_record_id', employeeRecordId),
    admin
      .from('employment_conditions')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('employee_record_id', employeeRecordId),
    getCachedOrganizationCalendar(organizationId),
  ]);

  if (schedulesResult.error || conditionsResult.error) {
    console.error(
      'Failed to load vacation counting context:',
      schedulesResult.error ?? conditionsResult.error
    );
    return null;
  }

  return {
    schedules: (schedulesResult.data ?? []).map(toWorkSchedule),
    conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
    calendar,
  };
}

/** All vacation requests of one employee record, newest first. */
export async function loadVacationRequestsForRecord(
  organizationId: string,
  employeeRecordId: string
): Promise<VacationRequest[] | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('vacation_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('employee_record_id', employeeRecordId)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('Failed to load vacation requests:', error);
    return null;
  }
  return (data ?? []).map(toVacationRequest);
}

/**
 * Approved vacation spans per employee record intersecting a date window —
 * the input `resolveDailyTarget` consumes. Only approved requests qualify;
 * pending requests are provisional and never reach targets.
 */
export async function loadApprovedVacationSpansByRecord(
  organizationId: string,
  windowStartIso: string,
  windowEndIso: string
): Promise<Map<string, ApprovedAbsenceSpan[]>> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('vacation_requests')
    .select('employee_record_id, start_date, end_date, day_portion')
    .eq('organization_id', organizationId)
    .eq('status', 'approved')
    .lte('start_date', windowEndIso)
    .gte('end_date', windowStartIso);

  if (error) {
    // Absence must never break the target surfaces: degrade to "no absence"
    // (targets stay pre-P1-06 correct) and log for diagnosis.
    console.error('Failed to load approved vacation spans:', error);
    return new Map();
  }

  const spansByRecord = new Map<string, ApprovedAbsenceSpan[]>();
  for (const row of data ?? []) {
    const spans = spansByRecord.get(row.employee_record_id) ?? [];
    spans.push({
      type: 'vacation',
      startDate: row.start_date,
      endDate: row.end_date,
      dayPortion: row.day_portion as ApprovedAbsenceSpan['dayPortion'],
    });
    spansByRecord.set(row.employee_record_id, spans);
  }
  return spansByRecord;
}

/**
 * Whether the user has an approved full-day vacation covering the date in
 * this organization (clock-in contradiction rule; resolved at action time).
 */
export async function hasApprovedFullDayVacationOn(
  organizationId: string,
  userId: string,
  dateIso: string
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (recordError) {
    console.error('Failed to load record for vacation clock check:', recordError);
    return false;
  }
  if (!record) return false;

  const { data, error } = await admin
    .from('vacation_requests')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('employee_record_id', record.id)
    .eq('status', 'approved')
    .eq('day_portion', 'full')
    .lte('start_date', dateIso)
    .gte('end_date', dateIso)
    .limit(1);
  if (error) {
    // Fail open: a transient read failure must not lock everyone out of time
    // capture; the approval/correction flow catches contradictions later.
    console.error('Failed vacation clock check:', error);
    return false;
  }
  return (data ?? []).length > 0;
}
