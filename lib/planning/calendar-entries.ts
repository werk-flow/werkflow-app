import 'server-only';
import { z } from '@/lib/zod';
import { parseIsoDateRange } from '@/lib/calendar/date-range';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { addLocalDays, formatBerlinLocalDateTime, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readAllRows } from '@/lib/supabase/query-batches';
import { WORK_EXECUTION_STATES } from '@/lib/work-lifecycle/types';
import type { PlanningCalendarEntry } from './types';

// Boundary schema for the embedded calendar read below. supabase-js cannot
// infer aliased, foreign-key-hinted embeds reliably, so the rows are parsed
// here instead of cast. Enum literals mirror the generated database types.
const calendarOccurrenceRowSchema = z.object({
  id: z.string(),
  series_id: z.string().nullable(),
  series_lineage_id: z.string().nullable(),
  job_id: z.string().nullable(),
  entry_kind: z.enum(['job_visit', 'internal']),
  internal_type: z.enum(['internal_work', 'meeting', 'training', 'other']).nullable(),
  time_kind: z.enum(['timed', 'all_day']),
  status: z.enum(['scheduled', 'skipped', 'cancelled']),
  is_exception: z.boolean(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  start_at: z.string().nullable(),
  end_at: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date_exclusive: z.string().nullable(),
  version: z.number(),
  assignments: z.array(
    z.object({
      employee_record_id: z.string(),
      employee_records: z.object({ user_id: z.string().nullable() }).nullable(),
    }),
  ),
  job: z
    .object({
      id: z.string(),
      title: z.string(),
      description: z.string().nullable(),
      job_number: z.string().nullable(),
      status: z.enum(['nicht_bearbeitet', 'in_bearbeitung', 'fertig', 'geparkt']),
      priority: z.enum(['niedrig', 'mittel', 'hoch']),
      location: z.string().nullable(),
      execution_version: z.number(),
      execution_state: z.enum(WORK_EXECUTION_STATES).nullable(),
      client: z.object({ id: z.string(), name: z.string(), address: z.string().nullable() }).nullable(),
      project: z
        .object({ id: z.string(), name: z.string(), project_number: z.string().nullable() })
        .nullable(),
    })
    .nullable(),
});

type CalendarOccurrenceRow = z.infer<typeof calendarOccurrenceRowSchema>;

const CALENDAR_OCCURRENCE_SELECT = [
  'id, series_id, series_lineage_id, job_id, entry_kind, internal_type, time_kind, status, is_exception, title, description, location, start_at, end_at, start_date, end_date_exclusive, version',
  'assignments:planning_occurrence_assignments(employee_record_id, employee_records(user_id))',
  'job:jobs!planning_occurrences_job_id_fkey(id, title, description, job_number, status, priority, location, execution_version, execution_state, client:clients(id, name, address), project:projects(id, name, project_number))',
].join(', ');

/**
 * Payload bound of one calendar window. The assignments arrive embedded in
 * their occurrences, so this protects the response size, not a read.
 */
const CALENDAR_ASSIGNMENT_CAP = 3 * LIST_ROW_CAP;

/**
 * The calendar window in two paged requests at most: occurrences embed their
 * assignments, job, client, and project through PostgREST relations, so no
 * dependent stage with batched id lists is needed. Employees read only occurrences they are assigned to
 * (an inner-joined alias of the same relation carries the filter) but still
 * see every assignee of those occurrences.
 */
export async function loadPlanningCalendarEntries(input: {
  orgId: string;
  userId: string;
  isManager: boolean;
  from: string;
  to: string;
}): Promise<PlanningCalendarEntry[] | null> {
  // Both dates are interpolated into the PostgREST filter below: reject
  // anything but a bounded ISO date range before building it.
  if (!parseIsoDateRange({ from: input.from, to: input.to })) return null;
  const admin = createSupabaseAdminClient();
  const fromInstant = resolveBerlinWallTime(`${input.from}T00:00`);
  const toInstant = resolveBerlinWallTime(`${addLocalDays(input.to, 1)}T00:00`);
  if (!fromInstant || !toInstant) return null;

  let ownRecordId: string | null = null;
  if (!input.isManager) {
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', input.orgId)
      .eq('user_id', input.userId)
      .maybeSingle();
    if (recordError) {
      logReadFailure('loadPlanningCalendarEntries: own employee record failed', { code: recordError.code });
      return null;
    }
    if (!record) return [];
    ownRecordId = record.id;
  }

  // A fresh builder per page: supabase-js builders are mutable, so one
  // instance cannot serve several ranges.
  const windowQuery = () => {
    const select = ownRecordId
      ? `${CALENDAR_OCCURRENCE_SELECT}, own:planning_occurrence_assignments!inner(employee_record_id)`
      : CALENDAR_OCCURRENCE_SELECT;
    let query = admin
      .from('planning_occurrences')
      .select(select)
      .eq('organization_id', input.orgId)
      // Skipped/cancelled occurrences stay traceably visible in the calendar;
      // overlap/capacity checks keep their own scheduled-only query.
      .in('status', ['scheduled', 'skipped', 'cancelled'])
      .or(
        `and(start_at.lt.${toInstant.instant.toISOString()},end_at.gt.${fromInstant.instant.toISOString()}),and(start_date.lte.${input.to},end_date_exclusive.gt.${input.from})`,
      );
    if (ownRecordId) query = query.eq('own.employee_record_id', ownRecordId);
    return query.order('start_at', { ascending: true, nullsFirst: false }).order('id');
  };
  // Paged complete read up to the declared cap: a single request returns at
  // most the project's `max_rows` (1,000) and would silently drop the rest of
  // a dense month. An overflow stays an explicit null.
  const {
    data: rows,
    error,
    overflow,
  } = await readAllRows<unknown, { message: string }>((from, to) => windowQuery().range(from, to), {
    cap: LIST_ROW_CAP,
  });
  if (error || overflow) {
    if (error) logReadFailure('Failed to load planning calendar window:', { message: error.message });
    if (overflow)
      logReadFailure('loadPlanningCalendarEntries: window occurrences overflowed', {
        code: 'row_overflow',
        organizationId: input.orgId,
        from: input.from,
        to: input.to,
      });
    return null;
  }
  const parsed = z.array(calendarOccurrenceRowSchema).safeParse(rows);
  if (!parsed.success) {
    logError('Planning calendar window rows did not match the expected shape.');
    return null;
  }
  const occurrences = parsed.data;
  const assignmentCount = occurrences.reduce((total, row) => total + row.assignments.length, 0);
  if (assignmentCount > CALENDAR_ASSIGNMENT_CAP) {
    logReadFailure('loadPlanningCalendarEntries: window assignments overflowed', {
      code: 'assignment_overflow',
      organizationId: input.orgId,
      from: input.from,
      to: input.to,
    });
    return null;
  }

  return occurrences.flatMap((occurrence) =>
    occurrence.job?.status === 'geparkt' ? [] : [toPlanningCalendarEntry(occurrence)],
  );
}

function toPlanningCalendarEntry(occurrence: CalendarOccurrenceRow): PlanningCalendarEntry {
  const job = occurrence.job;
  const records = occurrence.assignments.map((assignment) => assignment.employee_record_id);
  const startLocal = occurrence.start_at ? formatBerlinLocalDateTime(occurrence.start_at) : null;
  return {
    id: occurrence.id,
    occurrenceId: occurrence.id,
    jobId: occurrence.job_id,
    seriesId: occurrence.series_id,
    seriesLineageId: occurrence.series_lineage_id,
    entryKind: occurrence.entry_kind,
    internalType: occurrence.internal_type,
    timeKind: occurrence.time_kind,
    status: occurrence.status,
    version: occurrence.version,
    isException: occurrence.is_exception,
    title: job?.title.trim() || job?.description?.trim() || occurrence.title || '—',
    description: occurrence.description,
    location: occurrence.location ?? job?.location ?? null,
    plannedDate: startLocal?.slice(0, 10) ?? occurrence.start_date,
    plannedTime: startLocal?.slice(11, 16) ?? null,
    startAt: occurrence.start_at,
    endDateExclusive: occurrence.end_date_exclusive,
    endAt: occurrence.end_at,
    estimatedDurationMinutes:
      occurrence.start_at && occurrence.end_at
        ? Math.round(
            (new Date(occurrence.end_at).getTime() - new Date(occurrence.start_at).getTime()) / 60_000,
          )
        : null,
    assignedEmployeeRecordIds: records,
    assignedUserIds: occurrence.assignments.flatMap((assignment) => {
      const userId = assignment.employee_records?.user_id;
      return userId ? [userId] : [];
    }),
    jobNumber: job?.job_number ?? null,
    jobStatus: job?.status ?? null,
    jobExecutionVersion: job?.execution_version ?? 0,
    jobExecutionState: job?.execution_state ?? null,
    priority: job?.priority ?? null,
    clientName: job?.client?.name ?? null,
    clientAddress: job?.client?.address ?? null,
    projectName: job?.project?.name ?? null,
    projectNumber: job?.project?.project_number ?? null,
  };
}
