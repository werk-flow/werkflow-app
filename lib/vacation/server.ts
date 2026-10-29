import 'server-only';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { toEmploymentCondition } from '@/lib/personnel/types';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import type { ApprovedAbsenceSpan } from '@/lib/personnel/targets';
import {
  computeVacationBalance,
  countVacationDaysByYear,
  type VacationBalance,
  type VacationCountingContext,
} from './balance';
import { toVacationDayPortion, toVacationRequest, type VacationRequest } from './types';
import { logError } from '@/lib/logging';

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
  employeeRecordId: string,
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
    logReadFailure(
      'Failed to load vacation counting context:',
      schedulesResult.error ?? conditionsResult.error,
    );
    return null;
  }

  return {
    schedules: (schedulesResult.data ?? []).map(toWorkSchedule),
    conditions: (conditionsResult.data ?? []).map(toEmploymentCondition),
    calendar,
  };
}

/** All vacation requests of one employee record, newest first; null when the read fails or overflows. */
export async function loadVacationRequestsForRecord(
  organizationId: string,
  employeeRecordId: string,
  years?: { from: number; to: number },
): Promise<VacationRequest[] | null> {
  const admin = createSupabaseAdminClient();
  const query = () => {
    const recordQuery = admin
      .from('vacation_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('employee_record_id', employeeRecordId);
    // A balance of year Y counts only the days of Y, which lie inside requests that overlap Y.
    return years
      ? recordQuery.lte('start_date', `${years.to}-12-31`).gte('end_date', `${years.from}-01-01`)
      : recordQuery;
  };
  const { data, error } = await readCompleteRows(
    (from, to) => query().order('start_date', { ascending: false }).order('id').range(from, to),
    LIST_ROW_CAP,
  );

  if (error) {
    logError('Failed to load vacation requests:', error);
    return null;
  }
  return data.map(toVacationRequest);
}

/** The years whose balance the pending requests of one record show: the start year of each. */
function balanceYears(
  pendingRows: ReadonlyArray<{ employee_record_id: string; start_date: string }>,
  recordId: string,
): { from: number; to: number } {
  const years = pendingRows
    .filter((row) => row.employee_record_id === recordId)
    .map((row) => Number(row.start_date.slice(0, 4)));
  return { from: Math.min(...years), to: Math.max(...years) };
}

type RecordVacationCounting = {
  context: VacationCountingContext;
  /** The request's consumed days, counted once per request. */
  totalDaysOf: (request: VacationRequest) => number;
  /** The balance of one year, computed once per year; null when the requests could not be read. */
  balanceFor: (year: number) => VacationBalance | null;
};

/**
 * The approver queue's counting inputs per employee record: the context and
 * the requests are read once per record, each request's days are counted once
 * and each balance is computed once, however many pending rows show them.
 * The reader returns null when the record's counting context cannot be read.
 */
export function createVacationCountingCache(
  organizationId: string,
  pendingRows: ReadonlyArray<{ employee_record_id: string; start_date: string }>,
): (employeeRecordId: string) => Promise<RecordVacationCounting | null> {
  const countingByRecordId = new Map<string, Promise<RecordVacationCounting | null>>();
  return (employeeRecordId) => {
    let counting = countingByRecordId.get(employeeRecordId);
    if (!counting) {
      counting = loadRecordVacationCounting(
        organizationId,
        employeeRecordId,
        balanceYears(pendingRows, employeeRecordId),
      );
      countingByRecordId.set(employeeRecordId, counting);
    }
    return counting;
  };
}

async function loadRecordVacationCounting(
  organizationId: string,
  employeeRecordId: string,
  years: { from: number; to: number },
): Promise<RecordVacationCounting | null> {
  const context = await loadVacationCountingContext(organizationId, employeeRecordId);
  if (!context) return null;
  const requests = await loadVacationRequestsForRecord(organizationId, employeeRecordId, years);
  const daysByRequestId = new Map<string, Record<string, number>>();
  const daysByYearOf = (request: VacationRequest): Record<string, number> => {
    let days = daysByRequestId.get(request.id);
    if (!days) {
      days = countVacationDaysByYear(request, context);
      daysByRequestId.set(request.id, days);
    }
    return days;
  };
  const balanceByYear = new Map<number, VacationBalance>();
  const balanceFor = (year: number): VacationBalance | null => {
    if (!requests) return null;
    let balance = balanceByYear.get(year);
    if (!balance) {
      balance = computeVacationBalance(year, requests, context, daysByYearOf);
      balanceByYear.set(year, balance);
    }
    return balance;
  };
  const totalDaysOf = (request: VacationRequest): number =>
    Object.values(daysByYearOf(request)).reduce((total, days) => total + days, 0);
  return { context, totalDaysOf, balanceFor };
}

/**
 * The jobs each user is assigned to that are planned inside the span, for the
 * approver's conflict hint. Only assignments to jobs planned in the span are
 * read, never a user's assignment history. Null when a read fails.
 */
export async function loadPlannedAssignedJobs(
  organizationId: string,
  userIds: readonly string[],
  span: { from: string; to: string },
): Promise<{
  jobIdsByUserId: Map<string, string[]>;
  plannedJobById: Map<string, { title: string; plannedDate: string }>;
} | null> {
  const admin = createSupabaseAdminClient();
  const { data: assignmentRows, error: assignmentError } = await readInBatches(userIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('job_assignments')
          .select('job_id, user_id, jobs!inner(planned_date)')
          .eq('organization_id', organizationId)
          .in('user_id', [...batch])
          .gte('jobs.planned_date', span.from)
          .lte('jobs.planned_date', span.to)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (assignmentError) {
    logError('Error fetching job assignments for vacation approvals:', assignmentError);
    return null;
  }
  const jobIdsByUserId = new Map<string, string[]>();
  for (const assignment of assignmentRows) {
    jobIdsByUserId.set(assignment.user_id, [
      ...(jobIdsByUserId.get(assignment.user_id) ?? []),
      assignment.job_id,
    ]);
  }
  const assignedJobIds = [...new Set(assignmentRows.map((assignment) => assignment.job_id))];
  const { data: jobRows, error: jobError } = await readInBatches(assignedJobIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, title, planned_date')
          .eq('organization_id', organizationId)
          .in('id', [...batch])
          .gte('planned_date', span.from)
          .lte('planned_date', span.to)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (jobError) {
    logError('Error fetching assigned jobs for vacation approvals:', jobError);
    return null;
  }
  const plannedJobById = new Map<string, { title: string; plannedDate: string }>();
  for (const job of jobRows) {
    if (job.planned_date !== null)
      plannedJobById.set(job.id, { title: job.title, plannedDate: job.planned_date });
  }
  return { jobIdsByUserId, plannedJobById };
}

/**
 * Approved vacation spans per employee record intersecting a date window —
 * the input `resolveDailyTarget` consumes. Only approved requests qualify;
 * pending requests are provisional and never reach targets. A failed read
 * returns null: "no absence" would silently raise every target.
 */
export async function loadApprovedVacationSpansByRecord(
  organizationId: string,
  windowStartIso: string,
  windowEndIso: string,
): Promise<Map<string, ApprovedAbsenceSpan[]> | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('vacation_requests')
        .select('employee_record_id, start_date, end_date, day_portion')
        .eq('organization_id', organizationId)
        .eq('status', 'approved')
        .lte('start_date', windowEndIso)
        .gte('end_date', windowStartIso)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );

  if (error) {
    logError('Failed to load approved vacation spans:', error);
    return null;
  }

  const spansByRecord = new Map<string, ApprovedAbsenceSpan[]>();
  for (const row of data) {
    const spans = spansByRecord.get(row.employee_record_id) ?? [];
    spans.push({
      type: 'vacation',
      startDate: row.start_date,
      endDate: row.end_date,
      dayPortion: toVacationDayPortion(row.day_portion),
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
  dateIso: string,
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (recordError) {
    logError('Failed to load record for vacation clock check:', recordError);
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
    logError('Failed vacation clock check:', error);
    return false;
  }
  return (data ?? []).length > 0;
}
