'use server';

import type { ActionResult } from '@/lib/action-result';
import { readOrganizationCalendar } from '@/lib/personnel/calendar-reader';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import { parseIsoDateRange } from '@/lib/calendar/date-range';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { CalendarJob } from '@/lib/jobs/types';
import { getPlanningEntries } from '@/lib/planning/actions';
import { toCalendarJob } from '@/lib/planning/view-model';
import { getSicknessCalendarEntries, type SicknessCalendarEntry } from '@/lib/sickness/actions';
import { getTimeEntries } from '@/lib/time-tracking/entry-read-actions';
import { getChangeRequestsForEntries } from '@/lib/time-tracking/review-actions';
import { completeCalendarEntryRead } from './entry-read';
import { loadAbsenceAffectedVisits } from './absence-visits';
import {
  absenceAffectedVisitsInputSchema,
  absenceVisitWindow,
  type AbsenceAffectedVisits,
} from './absence-visits-types';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { TimeEntry, EntryChangeRequestMap } from '@/lib/time-tracking/types';
import { getVacationCalendarEntries, type VacationCalendarEntry } from '@/lib/vacation/calendar-actions';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

/**
 * One authorized aggregate reader for the complete calendar window. The client
 * calls it through GET /api/calendar-window so fresh reads run independently
 * of Next.js's browser Server Action queue. Constituent readers run in parallel
 * and keep their own role filters under one validated active organization.
 */
export type CalendarWindowInput = {
  organizationId: string;
  /** Inclusive instants of the rendered window, ISO 8601. */
  from: string;
  to: string;
  /** Berlin dates of the same window for date-scoped readers. */
  fromDate: string;
  toDate: string;
};

export type CalendarWindowResult = ActionResult<{
  entries: TimeEntry[];
  changeRequestMap: EntryChangeRequestMap;
  jobs: CalendarJob[];
  vacation: VacationCalendarEntry[];
  sickness: SicknessCalendarEntry[];
  holidays: OrganizationHolidayCalendar;
}>;

const DAY_MS = 86_400_000;

/**
 * The client derives both ranges from one window, so the instants must lie
 * inside the validated (at most 400-day) date window widened by one local day
 * on each side for any browser timezone. Without this bound the instant range
 * could read time entries far outside the planning window it was paired with.
 */
function instantsInsideDateWindow(
  dates: { from: string; to: string },
  fromInstant: number,
  toInstant: number,
): boolean {
  const floor = Date.parse(`${dates.from}T00:00:00Z`) - DAY_MS;
  const ceiling = Date.parse(`${dates.to}T00:00:00Z`) + 2 * DAY_MS;
  return fromInstant >= floor && toInstant <= ceiling;
}

const calendarWindowInputSchema = z.object({
  organizationId: uuidSchema,
  from: z.string().max(64),
  to: z.string().max(64),
  fromDate: z.string().max(10),
  toDate: z.string().max(10),
});

export async function getCalendarWindow(rawInput: CalendarWindowInput): Promise<CalendarWindowResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const parsed = calendarWindowInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const dates = parseIsoDateRange({ from: input.fromDate, to: input.toDate });
  const fromInstant = Date.parse(input.from);
  const toInstant = Date.parse(input.to);
  if (
    !dates ||
    !Number.isFinite(fromInstant) ||
    !Number.isFinite(toInstant) ||
    fromInstant > toInstant ||
    !instantsInsideDateWindow(dates, fromInstant, toInstant)
  ) {
    return { success: false, error: 'invalid_input' };
  }

  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  // Every constituent uses this request's active organization. A stale
  // client scope must fail, rather than mixing its time data with another org.
  if (auth.context.orgId !== input.organizationId) return { success: false, error: 'organization_changed' };

  const entriesPromise = completeCalendarEntryRead(
    getTimeEntries({ organizationId: input.organizationId, from: input.from, to: input.to }),
    getChangeRequestsForEntries,
  );
  const [entries, planning, vacation, sickness, holidays] = await Promise.all([
    entriesPromise,
    getPlanningEntries(dates.from, dates.to),
    getVacationCalendarEntries(dates),
    getSicknessCalendarEntries(dates),
    readOrganizationCalendar(input.organizationId, dates),
  ]);
  if (!entries.success) return entries;
  if (!planning.success) return { success: false, error: planning.error };
  if (!vacation.success) return { success: false, error: vacation.error };
  if (!sickness.success) return { success: false, error: sickness.error };

  return {
    success: true,
    // Official plus provisional projection, the same shape as the server prefetch.
    entries: entries.entries,
    changeRequestMap: entries.changeRequestMap,
    jobs: planning.entries.map(toCalendarJob),
    vacation: vacation.entries,
    sickness: sickness.entries,
    holidays,
  };
}

/**
 * The planned visits an absence takes the person away from (P1-08 with P1-24a):
 * the office reads them right after it records a sickness or approves a
 * vacation, with each visit's dispatch state for that person. Planning is
 * office work, so only Admin and Büro read it, for a record of their active
 * organization.
 */
export async function getAbsenceAffectedVisits(
  rawInput: unknown,
): Promise<ActionResult<AbsenceAffectedVisits>> {
  const parsed = absenceAffectedVisitsInputSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const window = absenceVisitWindow(parsed.data, getBusinessTodayIso());
  if (!window) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { orgId } = auth.context;
  const admin = createSupabaseAdminClient();
  const { data: record, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', parsed.data.employeeRecordId)
    .maybeSingle();
  if (error) {
    logError('getAbsenceAffectedVisits: employee record failed', error);
    return { success: false, error: 'load_failed' };
  }
  if (!record) return { success: false, error: 'employee_not_found' };
  const visits = await loadAbsenceAffectedVisits({ admin, orgId, employeeRecordId: record.id, ...window });
  if (!visits) return { success: false, error: 'load_failed' };
  return { success: true, visits, through: window.to };
}
