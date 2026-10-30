'use server';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { resolveActionContext } from '@/lib/org/action-context';
import { defaultCalendarWindow, parseIsoDateRange, type IsoDateRange } from '@/lib/calendar/date-range';
import { loadCalendarPersonNames } from './server';
import { toVacationDayPortion, type VacationDayPortion } from './types';
import { logError } from '@/lib/logging';
import { constrainedValue } from '@/lib/validation/constrained-value';
import { z } from '@/lib/zod';
import { isManagerRole } from '@/lib/roles';
import type { ActionFailure } from '@/lib/action-result';

// ============================================
// Calendar consumption (labeled absence entries)
// ============================================

const vacationCalendarRangeSchema = z.object({ from: z.string().max(10), to: z.string().max(10) }).optional();

// The statuses the calendar reads; the query filters on them.
const CALENDAR_VACATION_STATUSES = ['approved', 'pending'] as const;

export type VacationCalendarEntry = {
  id: string;
  employeeRecordId: string;
  personName: string;
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
  status: (typeof CALENDAR_VACATION_STATUSES)[number];
};

export type VacationCalendarEntriesResult =
  | { success: true; entries: VacationCalendarEntry[] }
  | ActionFailure;

export async function getVacationCalendarEntries(
  rangeInput?: IsoDateRange,
): Promise<VacationCalendarEntriesResult> {
  const parsedRange = vacationCalendarRangeSchema.safeParse(rangeInput);
  if (!parsedRange.success) return { success: false, error: 'invalid_input' };
  const range = parsedRange.data;
  try {
    const auth = await resolveActionContext();
    if (!auth.success) return auth;
    const { userId, orgId, role } = auth.context;
    const isManager = isManagerRole(role);

    // The calendar passes the window it renders, bounded at this boundary.
    // Without one, the default window of one year back and two ahead keeps
    // the payload bounded.
    const window = range === undefined ? defaultCalendarWindow() : parseIsoDateRange(range);
    if (!window) return { success: false, error: 'invalid_input' };
    const { from: windowStartIso, to: windowEndIso } = window;

    const admin = createSupabaseAdminClient();
    let query = admin
      .from('vacation_requests')
      .select('id, employee_record_id, start_date, end_date, day_portion, status')
      .eq('organization_id', orgId)
      .in('status', CALENDAR_VACATION_STATUSES)
      .lte('start_date', windowEndIso)
      .gte('end_date', windowStartIso)
      .order('start_date')
      .order('id');

    if (!isManager) {
      const { data: ownRecord, error: ownRecordError } = await admin
        .from('employee_records')
        .select('id')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (ownRecordError) {
        logError('Failed to load own record for calendar:', ownRecordError);
        return { success: false, error: 'load_failed' };
      }
      if (!ownRecord) return { success: true, entries: [] };
      query = query.eq('employee_record_id', ownRecord.id);
    }

    const { data: rows, error } = await readCompleteRows((from, to) => query.range(from, to), LIST_ROW_CAP);
    if (error) {
      logReadFailure('Failed to load vacation calendar entries:', error);
      return { success: false, error: 'load_failed' };
    }
    if (!rows || rows.length === 0) return { success: true, entries: [] };

    const nameByRecordId = await loadCalendarPersonNames(admin, orgId, [
      ...new Set(rows.map((row) => row.employee_record_id)),
    ]);
    if (!nameByRecordId) return { success: false, error: 'load_failed' };

    return {
      success: true,
      entries: rows.map((row) => ({
        id: row.id,
        employeeRecordId: row.employee_record_id,
        personName: nameByRecordId.get(row.employee_record_id) ?? 'Unbekannt',
        startDate: row.start_date,
        endDate: row.end_date,
        dayPortion: toVacationDayPortion(row.day_portion),
        status: constrainedValue(CALENDAR_VACATION_STATUSES, row.status, 'vacation status'),
      })),
    };
  } catch (error) {
    logError('Unexpected error in getVacationCalendarEntries:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
