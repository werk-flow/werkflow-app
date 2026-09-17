'use server';

import { readOrganizationCalendar } from '@/lib/personnel/calendar-reader';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import { parseIsoDateRange } from '@/lib/calendar/date-range';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { CalendarJob } from '@/lib/jobs/types';
import { getPlanningEntries } from '@/lib/planning/actions';
import { toCalendarJob } from '@/lib/planning/view-model';
import {
  getSicknessCalendarEntries,
  type SicknessCalendarEntry,
} from '@/lib/sickness/actions';
import { getTimeEntries, getChangeRequestsForEntries } from '@/lib/time-tracking/actions';
import { completeCalendarEntryRead } from './entry-read';
import type { TimeEntry, EntryChangeRequestMap } from '@/lib/time-tracking/types';
import {
  getVacationCalendarEntries,
  type VacationCalendarEntry,
} from '@/lib/vacation/actions';

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

export type CalendarWindowResult =
  | {
      success: true;
      entries: TimeEntry[];
      changeRequestMap: EntryChangeRequestMap;
      jobs: CalendarJob[];
      vacation: VacationCalendarEntry[];
      sickness: SicknessCalendarEntry[];
      holidays: OrganizationHolidayCalendar;
    }
  | { success: false; error: string };

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
  toInstant: number
): boolean {
  const floor = Date.parse(`${dates.from}T00:00:00Z`) - DAY_MS;
  const ceiling = Date.parse(`${dates.to}T00:00:00Z`) + 2 * DAY_MS;
  return fromInstant >= floor && toInstant <= ceiling;
}

export async function getCalendarWindow(
  input: CalendarWindowInput
): Promise<CalendarWindowResult> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  if (!input || typeof input !== 'object') return { success: false, error: 'invalid_input' };
  const dates = parseIsoDateRange({ from: input.fromDate, to: input.toDate });
  const fromInstant = Date.parse(input.from);
  const toInstant = Date.parse(input.to);
  if (
    !dates ||
    typeof input.organizationId !== 'string' ||
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
    // Official plus provisional projection, the same shape as the server prefetch (PF-06).
    entries: entries.entries,
    changeRequestMap: entries.changeRequestMap,
    jobs: planning.entries.map(toCalendarJob),
    vacation: vacation.entries,
    sickness: sickness.entries,
    holidays,
  };
}
