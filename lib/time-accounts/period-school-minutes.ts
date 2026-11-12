import 'server-only';

import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { loadSchoolDaySpansByRecord } from '@/lib/personnel/school-day-server';
import { loadActiveSicknessSpansByRecord } from '@/lib/sickness/server';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { loadApprovedVacationSpansByRecord } from '@/lib/vacation/server';
import { resolveEmployeeDailyTargets } from './period-daily-targets';
import { getDateRange } from './period-sources';

/**
 * The Berufsschule minutes per person of a period, for the period review: the
 * normal target each school day credits, so the office sees why a Soll is
 * lower. They are recomputed from the same sources the preparation reads and
 * not stored (werk-flow/werkflow-planning#165). A school day changed after
 * the preparation changes the period's fingerprint, so a period that can
 * close shows the minutes its calculation used. A failed read throws.
 */
export async function readPeriodSchoolMinutes(
  admin: AdminClient,
  orgId: string,
  period: { start: string; end: string },
  employeeRecordIds: readonly string[],
): Promise<Map<string, number>> {
  const school = await loadSchoolDaySpansByRecord(orgId, period.start, period.end);
  if (!school) throw new Error('period_school_minutes: school days');
  const recordIds = employeeRecordIds.filter((id) => school.has(id));
  // Most organizations have no apprentice in a period: one read answers them.
  if (recordIds.length === 0) return new Map();

  const [employees, schedules, conditions, calendar, vacations, sickness] = await Promise.all([
    readInBatches(recordIds, (ids) =>
      admin
        .from('employee_records')
        .select('id, entry_date, exit_date')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(recordIds, (ids) =>
      admin
        .from('work_schedules')
        .select('*')
        .eq('organization_id', orgId)
        .in('employee_record_id', [...ids]),
    ),
    readInBatches(recordIds, (ids) =>
      admin
        .from('employment_conditions')
        .select('*')
        .eq('organization_id', orgId)
        .in('employee_record_id', [...ids]),
    ),
    getCachedOrganizationCalendar(orgId),
    loadApprovedVacationSpansByRecord(orgId, period.start, period.end),
    loadActiveSicknessSpansByRecord(orgId, period.start, period.end),
  ]);
  const failed = employees.error ?? schedules.error ?? conditions.error;
  if (failed) throw failed;
  if (!vacations || !sickness) throw new Error('period_school_minutes: absences');

  const dates = getDateRange(period.start, period.end);
  const minutesByRecord = new Map<string, number>();
  for (const employee of employees.data ?? []) {
    const { dailyTargets } = resolveEmployeeDailyTargets(employee, new Map(), {
      sources: {
        schedules: schedules.data ?? [],
        conditions: conditions.data ?? [],
        vacations,
        sickness,
        school,
        calendar,
      },
      index: { dates },
    });
    const minutes = dailyTargets.reduce((sum, day) => sum + day.schoolMinutes, 0);
    if (minutes > 0) minutesByRecord.set(employee.id, minutes);
  }
  return minutesByRecord;
}
