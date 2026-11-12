'use server';

import type { ActionFailure } from '@/lib/action-result';
import { isValidIsoDate } from '@/lib/calendar/date-range';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { resolveActionContext } from '@/lib/org/action-context';
import { isManagerRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isPeriodClosedError } from '@/lib/time-tracking/closed-periods';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { loadSchoolDaysForRecord } from './school-day-server';
import {
  SCHOOL_DAY_COLUMNS,
  SCHOOL_DAY_KINDS,
  SCHOOL_WEEKDAYS,
  toSchoolDay,
  type SchoolDay,
} from './school-days';

// Berufsschule days per apprentice (werk-flow/werkflow-planning#165). Admin
// and Büro record, end and cancel them; the database trigger keeps every row
// and refuses a change that reaches into a closed period
// (supabase/migrations/20261202090000_record_apprentice_school_days.sql).

/** A school rule may start at most this far back: earlier months are long settled. */
const EARLIEST_START_YEARS_BACK = 1;
/** A weekly rule or block may end at most this long after its start (an apprenticeship's length). */
const LATEST_END_DAYS_AFTER_START = 4 * 366;
/** A block is a few weeks of Blockunterricht, never longer than a year. */
const LONGEST_BLOCK_DAYS = 366;

/** The trigger's and the constraints' refusals that reach the office as their own code. */
type SchoolDayWriteFailure =
  | 'period_closed'
  | 'school_day_overlap'
  | 'school_day_not_found'
  | 'school_day_end_not_earlier'
  | 'save_failed';

function schoolDayWriteFailure(
  error: { code?: string; message: string },
  label: string,
): ActionFailure<SchoolDayWriteFailure> {
  if (isPeriodClosedError(error)) return { success: false, error: 'period_closed' };
  if (error.code === '23P01') return { success: false, error: 'school_day_overlap' };
  if (error.message === 'school_day_end_not_earlier')
    return { success: false, error: 'school_day_end_not_earlier' };
  logError(label, error);
  return { success: false, error: 'save_failed' };
}

async function resolveOffice() {
  const auth = await resolveActionContext();
  if (!auth.success) return auth;
  if (!isManagerRole(auth.context.role)) return { success: false as const, error: 'not_authorized' };
  return auth;
}

export type SchoolDaysResult = { success: true; schoolDays: SchoolDay[] } | ActionFailure;

/** Every school rule of one apprentice, cancelled ones included, for the office's section. */
export async function getSchoolDaysForRecord(employeeRecordIdInput: string): Promise<SchoolDaysResult> {
  const parsed = uuidSchema.safeParse(employeeRecordIdInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const auth = await resolveOffice();
    if (!auth.success) return auth;
    const schoolDays = await loadSchoolDaysForRecord(auth.context.orgId, parsed.data);
    if (!schoolDays) return { success: false, error: 'load_failed' };
    return { success: true, schoolDays };
  } catch (error) {
    logError('getSchoolDaysForRecord: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

const addSchoolDayInputSchema = z.object({
  employeeRecordId: uuidSchema,
  kind: z.enum(SCHOOL_DAY_KINDS),
  weekday: z
    .number()
    .int()
    .refine((value) => SCHOOL_WEEKDAYS.some((weekday) => weekday === value))
    .nullable(),
  startDate: z.string().max(10),
  endDate: z.string().max(10).nullable(),
});

export type AddSchoolDayInput = z.infer<typeof addSchoolDayInputSchema>;

type AddSchoolDayRefusal =
  | 'invalid_dates'
  | 'invalid_range'
  | 'start_too_early'
  | 'range_too_long'
  | 'block_needs_end'
  | 'weekday_required';

/** The date and shape rules of a new rule; the database repeats the shape. */
function validateNewSchoolDay(input: AddSchoolDayInput): AddSchoolDayRefusal | null {
  if (!isValidIsoDate(input.startDate) || (input.endDate !== null && !isValidIsoDate(input.endDate))) {
    return 'invalid_dates';
  }
  if (input.kind === 'weekday' && input.weekday === null) return 'weekday_required';
  if (input.kind === 'block' && input.endDate === null) return 'block_needs_end';
  if (input.endDate !== null && input.endDate < input.startDate) return 'invalid_range';
  const businessYear = Number(getBusinessTodayIso().slice(0, 4));
  if (input.startDate < `${businessYear - EARLIEST_START_YEARS_BACK}-01-01`) return 'start_too_early';
  const longest = input.kind === 'block' ? LONGEST_BLOCK_DAYS : LATEST_END_DAYS_AFTER_START;
  if (input.endDate !== null && input.endDate > addLocalDays(input.startDate, longest))
    return 'range_too_long';
  return null;
}

export type SchoolDayWriteResult = { success: true; schoolDay: SchoolDay } | ActionFailure;

/** Records a weekly school day or a block for an apprentice of the caller's organization. */
export async function addSchoolDay(rawInput: AddSchoolDayInput): Promise<SchoolDayWriteResult> {
  const parsed = addSchoolDayInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveOffice();
    if (!auth.success) return auth;
    const refusal = validateNewSchoolDay(input);
    if (refusal) return { success: false, error: refusal };
    const { orgId, userId } = auth.context;

    const admin = createSupabaseAdminClient();
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('id', input.employeeRecordId)
      .maybeSingle();
    if (recordError) {
      logError('addSchoolDay: record read failed', recordError);
      return { success: false, error: 'load_failed' };
    }
    if (!record) return { success: false, error: 'record_not_found' };

    const { data, error } = await admin
      .from('school_days')
      .insert({
        organization_id: orgId,
        employee_record_id: record.id,
        kind: input.kind,
        weekday: input.kind === 'weekday' ? input.weekday : null,
        start_date: input.startDate,
        end_date: input.endDate,
        created_by: userId,
      })
      .select(SCHOOL_DAY_COLUMNS)
      .single();
    if (error) return schoolDayWriteFailure(error, 'addSchoolDay: insert failed');
    return { success: true, schoolDay: toSchoolDay(data) };
  } catch (error) {
    logError('addSchoolDay: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

const endSchoolDayInputSchema = z.object({ schoolDayId: uuidSchema, endDate: z.string().max(10) });

/**
 * Ends a weekly rule on its last school day, e.g. when the apprentice
 * changes class. Only an earlier end: a later one is a new rule.
 */
export async function endSchoolDay(
  rawInput: z.infer<typeof endSchoolDayInputSchema>,
): Promise<SchoolDayWriteResult> {
  const parsed = endSchoolDayInputSchema.safeParse(rawInput);
  if (!parsed.success || !isValidIsoDate(parsed.data.endDate))
    return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  try {
    const auth = await resolveOffice();
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;
    const admin = createSupabaseAdminClient();
    const { data: current, error: readError } = await admin
      .from('school_days')
      .select(SCHOOL_DAY_COLUMNS)
      .eq('organization_id', orgId)
      .eq('id', input.schoolDayId)
      .is('cancelled_at', null)
      .maybeSingle();
    if (readError) {
      logError('endSchoolDay: read failed', readError);
      return { success: false, error: 'load_failed' };
    }
    if (!current || current.kind !== 'weekday') return { success: false, error: 'school_day_not_found' };
    if (input.endDate < current.start_date) return { success: false, error: 'invalid_range' };
    if (current.end_date !== null && input.endDate >= current.end_date) {
      return { success: false, error: 'school_day_end_not_earlier' };
    }

    // The filter on the end date the check read: a change in between updates
    // nothing, and the office reloads.
    const base = admin
      .from('school_days')
      .update({ end_date: input.endDate, ended_at: new Date().toISOString(), ended_by: userId })
      .eq('organization_id', orgId)
      .eq('id', current.id)
      .is('cancelled_at', null);
    const { data, error } = await (
      current.end_date === null ? base.is('end_date', null) : base.eq('end_date', current.end_date)
    )
      .select(SCHOOL_DAY_COLUMNS)
      .maybeSingle();
    if (error) return schoolDayWriteFailure(error, 'endSchoolDay: update failed');
    if (!data) return { success: false, error: 'school_day_not_found' };
    return { success: true, schoolDay: toSchoolDay(data) };
  } catch (error) {
    logError('endSchoolDay: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}

/** Cancels a wrongly recorded rule. The row stays, marked cancelled. */
export async function cancelSchoolDay(schoolDayIdInput: string): Promise<SchoolDayWriteResult> {
  const parsed = uuidSchema.safeParse(schoolDayIdInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  try {
    const auth = await resolveOffice();
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('school_days')
      .update({ cancelled_at: new Date().toISOString(), cancelled_by: userId })
      .eq('organization_id', orgId)
      .eq('id', parsed.data)
      .is('cancelled_at', null)
      .select(SCHOOL_DAY_COLUMNS)
      .maybeSingle();
    if (error) return schoolDayWriteFailure(error, 'cancelSchoolDay: update failed');
    if (!data) return { success: false, error: 'school_day_not_found' };
    return { success: true, schoolDay: toSchoolDay(data) };
  } catch (error) {
    logError('cancelSchoolDay: unexpected failure', error);
    return { success: false, error: 'unexpected_error' };
  }
}
