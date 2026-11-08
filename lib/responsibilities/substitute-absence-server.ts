import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import type { SubstituteAbsenceSpan } from './substitute-absence';

/**
 * The full-day absences of the organization that reach into the window:
 * approved vacation and reported sickness, without their type, so the owner
 * sees no more than the shared calendar's neutral absence. `until` null reads
 * every absence from `from` on; `employeeRecordId` narrows to one person.
 * Null when a read failed: "no absence" would hide a substitute who is away.
 * Callers have established the owner; the spans are personal data and are
 * never logged.
 */
export async function loadSubstituteAbsenceSpans(
  admin: AdminClient,
  input: { organizationId: string; from: string; until: string | null; employeeRecordId?: string },
): Promise<SubstituteAbsenceSpan[] | null> {
  const [vacationResult, sicknessResult] = await Promise.all([
    readCompleteRows((from, to) => {
      const query = admin
        .from('vacation_requests')
        .select('employee_record_id, start_date, end_date')
        .eq('organization_id', input.organizationId)
        .eq('status', 'approved')
        .eq('day_portion', 'full')
        .gte('end_date', input.from);
      const bounded = input.until === null ? query : query.lte('start_date', input.until);
      const scoped = input.employeeRecordId
        ? bounded.eq('employee_record_id', input.employeeRecordId)
        : bounded;
      return scoped.order('id').range(from, to);
    }, LIST_ROW_CAP),
    readCompleteRows((from, to) => {
      const query = admin
        .from('sickness_reports')
        .select('employee_record_id, start_date, end_date')
        .eq('organization_id', input.organizationId)
        .eq('status', 'reported')
        .eq('day_portion', 'full')
        .or(`end_date.gte.${input.from},end_date.is.null`);
      const bounded = input.until === null ? query : query.lte('start_date', input.until);
      const scoped = input.employeeRecordId
        ? bounded.eq('employee_record_id', input.employeeRecordId)
        : bounded;
      return scoped.order('id').range(from, to);
    }, LIST_ROW_CAP),
  ]);
  const failed = vacationResult.error ?? sicknessResult.error;
  if (failed) {
    logReadFailure('Failed to load substitute absences:', failed);
    return null;
  }
  return [...vacationResult.data, ...sicknessResult.data].map((row) => ({
    employeeRecordId: row.employee_record_id,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}
