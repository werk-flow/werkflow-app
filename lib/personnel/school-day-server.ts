import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';
import { groupSchoolDaySpansByRecord, SCHOOL_DAY_COLUMNS, toSchoolDay, type SchoolDay } from './school-days';
import type { ApprovedAbsenceSpan } from './targets';

// Server-only loaders of the Berufsschule days. Nothing here authorizes:
// callers resolve their own authority first and pass the organization they
// established.

/** Every school-day rule of one record, cancelled ones included, newest start first; null when the read fails. */
export async function loadSchoolDaysForRecord(
  organizationId: string,
  employeeRecordId: string,
): Promise<SchoolDay[] | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('school_days')
        .select(SCHOOL_DAY_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('employee_record_id', employeeRecordId)
        .order('start_date', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('loadSchoolDaysForRecord: school days read failed', error);
    return null;
  }
  return data.map(toSchoolDay);
}

/**
 * The active school rules intersecting a window, cancelled ones excluded;
 * null when the read fails: "no school day" would silently raise a target.
 */
export async function loadActiveSchoolDays(
  organizationId: string,
  windowStartIso: string,
  windowEndIso: string,
  /** Narrows the read to one record (single-person target surfaces). */
  employeeRecordId?: string,
): Promise<SchoolDay[] | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await readCompleteRows((from, to) => {
    const query = admin
      .from('school_days')
      .select(SCHOOL_DAY_COLUMNS)
      .eq('organization_id', organizationId)
      .is('cancelled_at', null)
      .lte('start_date', windowEndIso)
      .or(`end_date.gte.${windowStartIso},end_date.is.null`);
    return (employeeRecordId ? query.eq('employee_record_id', employeeRecordId) : query)
      .order('id')
      .range(from, to);
  }, LIST_ROW_CAP);
  if (error) {
    logError('loadActiveSchoolDays: school days read failed', error);
    return null;
  }
  return data.map(toSchoolDay);
}

/** The full-day school spans per record inside a window, the third absence input of `resolveDailyTarget`. */
export async function loadSchoolDaySpansByRecord(
  organizationId: string,
  windowStartIso: string,
  windowEndIso: string,
  employeeRecordId?: string,
): Promise<Map<string, ApprovedAbsenceSpan[]> | null> {
  const schoolDays = await loadActiveSchoolDays(
    organizationId,
    windowStartIso,
    windowEndIso,
    employeeRecordId,
  );
  if (!schoolDays) return null;
  return groupSchoolDaySpansByRecord(schoolDays, windowStartIso, windowEndIso);
}
