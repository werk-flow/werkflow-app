import 'server-only';
import {
  planningOptionsSchema,
  type PlanningOptionResult,
  type planningOptionRequestSchema,
} from './option-types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { z } from '@/lib/zod';

import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import { toEmploymentCondition } from '@/lib/personnel/types';
import {
  resolveDailyTarget,
  type ApprovedAbsenceSpan,
  type DailyTarget,
  type OrganizationHolidayCalendar,
} from '@/lib/personnel/targets';
import type { AssignmentEvaluation } from '@/lib/qualifications/types';
import { loadActiveSicknessSpansByRecord } from '@/lib/sickness/server';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database, Json, Tables } from '@/lib/supabase/database.types';
import { toJson } from '@/lib/supabase/json';
import { loadApprovedVacationSpansByRecord } from '@/lib/vacation/server';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { fingerprintSnapshot } from './capacity';
import { addLocalDays, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import {
  assignedOccurrenceRowsSchema,
  buildQualificationAssessmentRequests,
  collectAssessedOccurrenceDates,
  evaluateProposedCapacity,
  type AssignmentsForOccurrence,
} from './planned-load';
import { loadPlanningQualificationEvaluations } from './qualification-evaluations';
import type {
  CapacityEvaluation,
  MaterializedOccurrence,
  PlanningAssignmentDraft,
  PlanningConflict,
} from './types';

export type PlanningAssessment = {
  conflicts: PlanningConflict[];
  assessmentFingerprint: string;
  capacitySnapshot: Json;
  capacityFingerprint: string;
  qualificationSnapshot: Json;
  qualificationFingerprint: string;
};

export async function loadPlanningOptions(
  organizationId: string,
  input: z.output<typeof planningOptionRequestSchema>,
): Promise<PlanningOptionResult> {
  const { data, error } = await createSupabaseAdminClient().rpc('search_planning_options', {
    p_organization_id: organizationId,
    p_kind: input.kind,
    p_query: input.query,
    p_offset: input.offset,
    p_selected_ids: input.selectedIds,
    p_default_user_ids: input.defaultUserIds,
  });
  if (error) {
    logReadFailure('Failed to search planning options', { code: error.code });
    return { success: false, error: 'load_failed' };
  }
  const parsed = planningOptionsSchema.safeParse(data);
  if (!parsed.success) {
    logReadFailure('Unexpected planning options shape', {
      paths: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return { success: false, error: 'load_failed' };
  }
  return { success: true, ...parsed.data };
}

export async function expandPlanningTeamsForDates(input: {
  admin: AdminClient;
  orgId: string;
  teamIds: string[];
  localDates: string[];
}): Promise<Map<string, PlanningAssignmentDraft[]> | null> {
  const uniqueDates = [...new Set(input.localDates)].sort();
  const result = new Map<string, PlanningAssignmentDraft[]>();
  const firstDate = uniqueDates[0];
  const lastDate = uniqueDates.at(-1);
  if (input.teamIds.length === 0 || !firstDate || !lastDate) return result;
  const { data, error } = await readInBatches(input.teamIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        input.admin
          .from('team_memberships')
          .select('team_id, employee_record_id, valid_from, valid_until')
          .eq('organization_id', input.orgId)
          .in('team_id', [...batch])
          .lte('valid_from', lastDate)
          .or(`valid_until.is.null,valid_until.gte.${firstDate}`)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (error) {
    logReadFailure('expandPlanningTeamsForDates: team memberships failed', {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  for (const localDate of uniqueDates) {
    result.set(
      localDate,
      data
        .filter(
          (membership) =>
            membership.valid_from <= localDate &&
            (!membership.valid_until || localDate <= membership.valid_until),
        )
        .map((membership) => ({
          employeeRecordId: membership.employee_record_id,
          teamSourceId: membership.team_id,
        })),
    );
  }
  return result;
}

type PendingVacationRow = Pick<
  Tables<'vacation_requests'>,
  'employee_record_id' | 'start_date' | 'end_date' | 'day_portion'
>;

/** An employee record with the entry and exit dates that bound its targets. */
export type EmployedRecord = Pick<Tables<'employee_records'>, 'id' | 'entry_date' | 'exit_date'>;

export type DailyTargetsByRecord = {
  /** Keyed by `${employeeRecordId}:${date}`. */
  targetByEmployeeDate: Map<string, DailyTarget>;
  pendingVacation: PendingVacationRow[];
};

/** Each person's target on each date, keyed by `${employeeRecordId}:${date}`. */
function resolveTargetsByEmployeeDate(input: {
  employees: readonly EmployedRecord[];
  dates: string[];
  scheduleRows: Tables<'work_schedules'>[];
  conditionRows: Tables<'employment_conditions'>[];
  calendar: OrganizationHolidayCalendar;
  vacationSpans: Map<string, ApprovedAbsenceSpan[]>;
  sicknessSpans: Map<string, ApprovedAbsenceSpan[]>;
}): Map<string, DailyTarget> {
  const { calendar, vacationSpans, sicknessSpans } = input;
  const schedulesByRecord = new Map<string, ReturnType<typeof toWorkSchedule>[]>();
  for (const row of input.scheduleRows) {
    const schedule = toWorkSchedule(row);
    const schedules = schedulesByRecord.get(schedule.employeeRecordId) ?? [];
    schedules.push(schedule);
    schedulesByRecord.set(schedule.employeeRecordId, schedules);
  }
  const conditionsByRecord = new Map<string, ReturnType<typeof toEmploymentCondition>[]>();
  for (const row of input.conditionRows) {
    const condition = toEmploymentCondition(row);
    const conditions = conditionsByRecord.get(condition.employeeRecordId) ?? [];
    conditions.push(condition);
    conditionsByRecord.set(condition.employeeRecordId, conditions);
  }
  const targetByEmployeeDate = new Map<string, DailyTarget>();
  for (const employee of input.employees) {
    const employeeRecordId = employee.id;
    for (const date of input.dates) {
      targetByEmployeeDate.set(
        `${employeeRecordId}:${date}`,
        resolveDailyTarget({
          dateIso: date,
          schedules: schedulesByRecord.get(employeeRecordId) ?? [],
          conditions: conditionsByRecord.get(employeeRecordId) ?? [],
          calendar,
          employment: { entryDate: employee.entry_date, exitDate: employee.exit_date },
          absences: [
            ...(vacationSpans.get(employeeRecordId) ?? []),
            ...(sicknessSpans.get(employeeRecordId) ?? []),
          ],
        }),
      );
    }
  }
  return targetByEmployeeDate;
}

/**
 * The per-person daily targets the planning assessment and the Plantafel read
 * share: schedules, employment conditions, holiday context, approved vacation
 * and sickness spans, plus the pending vacation requests that only warn.
 * One home, so a board cell and a planning warning can never disagree.
 */
export async function loadDailyTargetsByRecord(input: {
  admin: AdminClient;
  orgId: string;
  employees: readonly EmployedRecord[];
  /** Sorted ISO dates; the first and last bound every read. */
  dates: string[];
}): Promise<DailyTargetsByRecord | null> {
  const windowStart = input.dates[0];
  const windowEnd = input.dates.at(-1);
  const employeeRecordIds = input.employees.map((employee) => employee.id);
  if (!windowStart || !windowEnd || employeeRecordIds.length === 0) {
    return { targetByEmployeeDate: new Map(), pendingVacation: [] };
  }
  // Id lists are organization-sized here (every row of the Plantafel); one
  // query per 100 ids keeps each request under the gateway's URL limit (about
  // 200 ids in one request answer 414 URI too long).
  const [schedulesResult, conditionsResult, calendar, vacationSpans, sicknessSpans, pendingVacationResult] =
    await Promise.all([
      readInBatches(employeeRecordIds, (ids) =>
        input.admin
          .from('work_schedules')
          .select('*')
          .eq('organization_id', input.orgId)
          .in('employee_record_id', [...ids]),
      ),
      readInBatches(employeeRecordIds, (ids) =>
        input.admin
          .from('employment_conditions')
          .select('*')
          .eq('organization_id', input.orgId)
          .in('employee_record_id', [...ids]),
      ),
      getCachedOrganizationCalendar(input.orgId),
      loadApprovedVacationSpansByRecord(input.orgId, windowStart, windowEnd),
      loadActiveSicknessSpansByRecord(input.orgId, windowStart, windowEnd),
      readInBatches(employeeRecordIds, (ids) =>
        input.admin
          .from('vacation_requests')
          .select('employee_record_id, start_date, end_date, day_portion')
          .eq('organization_id', input.orgId)
          .eq('status', 'pending')
          .in('employee_record_id', [...ids])
          .lte('start_date', windowEnd)
          .gte('end_date', windowStart),
      ),
    ]);
  const failed = schedulesResult.error ?? conditionsResult.error ?? pendingVacationResult.error;
  if (failed) {
    logReadFailure('Failed to load daily targets', { code: 'code' in failed ? failed.code : 'unknown' });
    return null;
  }
  // The span readers log their own failure; a missing span map is not "no absence".
  if (!vacationSpans || !sicknessSpans) return null;

  const targetByEmployeeDate = resolveTargetsByEmployeeDate({
    employees: input.employees,
    dates: input.dates,
    scheduleRows: schedulesResult.data ?? [],
    conditionRows: conditionsResult.data ?? [],
    calendar,
    vacationSpans,
    sicknessSpans,
  });
  return { targetByEmployeeDate, pendingVacation: pendingVacationResult.data ?? [] };
}

// Scheduled occurrences that already hold one of the assessed people. The
// inner-joined alias carries the person filter, so the read is bounded by the
// assessed people instead of every occurrence of the organization; the select
// is a string, so the rows are validated after the read.
const ASSIGNED_OCCURRENCE_SELECT: string =
  'id, time_kind, start_at, end_at, start_date, end_date_exclusive, assigned:planning_occurrence_assignments!inner(employee_record_id)';

type ConflictEmployeeRecord = Pick<
  Database['public']['Tables']['employee_records']['Row'],
  'id' | 'user_id' | 'first_name' | 'last_name'
>;

function planningAssessmentReadFailed(read: string, error: { message: string; code?: string }): null {
  logReadFailure(`assessPlanningOccurrences: ${read} failed`, {
    code: error.code ?? 'unknown',
    message: error.message,
  });
  return null;
}

async function emptyPlanningAssessment(): Promise<PlanningAssessment> {
  const capacitySnapshot = { employeeDays: [], conflicts: [] };
  const qualificationSnapshot = { evaluations: [] };
  const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
  const qualificationFingerprint = await fingerprintSnapshot(qualificationSnapshot);
  return {
    conflicts: [],
    assessmentFingerprint: await fingerprintSnapshot({
      capacityFingerprint,
      qualificationFingerprint,
    }),
    capacitySnapshot: toJson(capacitySnapshot),
    capacityFingerprint,
    qualificationSnapshot: toJson(qualificationSnapshot),
    qualificationFingerprint,
  };
}

// Warnings must explain the affected person, not only the date. The name is
// attached AFTER fingerprinting so snapshots and fingerprints stay
// name-independent (a later rename never invalidates a stored assessment).
// Member-linked records carry their names on the profile, so resolution
// follows the same precedence as the planning pickers.
async function loadConflictEmployeeNames(
  admin: AdminClient,
  records: ConflictEmployeeRecord[],
): Promise<Map<string, string | null> | null> {
  const conflictUserIds = records.flatMap((record) => (record.user_id ? [record.user_id] : []));
  const conflictProfilesResult = await readInBatches(conflictUserIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (conflictProfilesResult.error)
    return planningAssessmentReadFailed('profiles', conflictProfilesResult.error);
  const profileNameByUserId = new Map(
    conflictProfilesResult.data.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim(),
    ]),
  );
  return new Map(
    records.map((record) => {
      const profileName = record.user_id ? profileNameByUserId.get(record.user_id) : null;
      const recordName = [record.first_name, record.last_name].filter(Boolean).join(' ').trim();
      return [record.id, profileName || recordName || null];
    }),
  );
}

/**
 * The assessed people's records, their daily targets and the scheduled
 * occurrences that already hold one of them inside the assessed dates.
 */
async function loadAssessmentContext(input: {
  admin: AdminClient;
  orgId: string;
  employeeRecordIds: string[];
  uniqueDates: string[];
}) {
  const { admin, employeeRecordIds, uniqueDates } = input;
  const windowStart = uniqueDates[0];
  if (!windowStart) return null;
  const windowEnd = uniqueDates.at(-1) ?? windowStart;
  const windowStartInstant = resolveBerlinWallTime(`${windowStart}T00:00`);
  const windowEndInstant = resolveBerlinWallTime(`${addLocalDays(windowEnd, 1)}T00:00`);
  if (!windowStartInstant || !windowEndInstant) return null;
  // The targets need each record's entry and exit dates, so they follow the
  // record read while the occurrence read runs beside both.
  const recordsAndTargets = readInBatches(employeeRecordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name, entry_date, exit_date')
      .eq('organization_id', input.orgId)
      .in('id', [...batch]),
  ).then(async (recordsResult) => ({
    recordsResult,
    targets: recordsResult.error
      ? null
      : await loadDailyTargetsByRecord({
          admin,
          orgId: input.orgId,
          employees: recordsResult.data,
          dates: uniqueDates,
        }),
  }));
  const [{ recordsResult, targets }, existingOccurrenceResult] = await Promise.all([
    recordsAndTargets,
    readInBatches(employeeRecordIds, (batch) =>
      readCompleteRows<unknown, { message: string }>(
        (from, to) =>
          admin
            .from('planning_occurrences')
            .select(ASSIGNED_OCCURRENCE_SELECT)
            .eq('organization_id', input.orgId)
            .eq('status', 'scheduled')
            .or(
              `and(start_at.lt.${windowEndInstant.instant.toISOString()},end_at.gt.${windowStartInstant.instant.toISOString()}),and(start_date.lte.${windowEnd},end_date_exclusive.gt.${windowStart})`,
            )
            .in('assigned.employee_record_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (recordsResult.error) return planningAssessmentReadFailed('employee records', recordsResult.error);
  if (existingOccurrenceResult.error)
    return planningAssessmentReadFailed('existing occurrences', existingOccurrenceResult.error);
  if (!targets) return null;
  if (recordsResult.data.length !== employeeRecordIds.length) {
    return planningAssessmentReadFailed('employee records', {
      code: 'employee_not_found',
      message: 'An assigned employee record is missing.',
    });
  }
  const parsedExisting = assignedOccurrenceRowsSchema.safeParse(existingOccurrenceResult.data);
  if (!parsedExisting.success) {
    return planningAssessmentReadFailed('existing occurrences', {
      code: 'unexpected_shape',
      message: 'Rows did not match the expected shape.',
    });
  }
  return { records: recordsResult.data, targets, existingRows: parsedExisting.data };
}

/** Fingerprints the capacity and qualification snapshots, then names the people the warnings concern. */
async function finishPlanningAssessment(input: {
  admin: AdminClient;
  capacity: CapacityEvaluation;
  evaluations: AssignmentEvaluation[];
  records: ConflictEmployeeRecord[];
}): Promise<PlanningAssessment | null> {
  const { capacity, evaluations } = input;
  const qualificationConflicts: PlanningConflict[] = evaluations
    .filter((evaluation) => evaluation.requiresOverride)
    .map((evaluation) => ({
      kind: 'qualification',
      severity: 'warning',
      employeeRecordId: null,
      localDate: evaluation.assessedForDate,
      message: 'Die Qualifikationsanforderungen des Auftrags sind nicht vollständig abgedeckt.',
      details: { fingerprint: evaluation.fingerprint },
    }));
  const capacitySnapshot = {
    employeeDays: capacity.employeeDays,
    conflicts: capacity.conflicts,
  };
  const qualificationSnapshot = { evaluations };
  const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
  const qualificationFingerprint = await fingerprintSnapshot(qualificationSnapshot);
  const nameByRecordId = await loadConflictEmployeeNames(input.admin, input.records);
  if (!nameByRecordId) return null;
  const withEmployeeName = (conflict: PlanningConflict): PlanningConflict => ({
    ...conflict,
    employeeName: conflict.employeeRecordId ? (nameByRecordId.get(conflict.employeeRecordId) ?? null) : null,
  });
  return {
    conflicts: [...capacity.conflicts, ...qualificationConflicts].map(withEmployeeName),
    assessmentFingerprint: await fingerprintSnapshot({
      capacityFingerprint,
      qualificationFingerprint,
    }),
    capacitySnapshot: toJson(capacitySnapshot),
    capacityFingerprint,
    qualificationSnapshot: toJson(qualificationSnapshot),
    qualificationFingerprint,
  };
}

export async function assessPlanningOccurrences(input: {
  orgId: string;
  jobId: string | null;
  occurrences: MaterializedOccurrence[];
  assignments: PlanningAssignmentDraft[];
  assignmentsByOriginalStartLocal?: ReadonlyMap<string, PlanningAssignmentDraft[]>;
  excludeOccurrenceId?: string;
  excludeOccurrenceIds?: string[];
}): Promise<PlanningAssessment | null> {
  const assignmentsFor: AssignmentsForOccurrence = (occurrence) => [
    ...new Map(
      (input.assignmentsByOriginalStartLocal
        ? (input.assignmentsByOriginalStartLocal.get(occurrence.originalStartLocal) ?? [])
        : input.assignments
      ).map((assignment) => [assignment.employeeRecordId, assignment]),
    ).values(),
  ];
  const employeeRecordIds = [
    ...new Set(
      input.occurrences.flatMap((occurrence) =>
        assignmentsFor(occurrence).map((assignment) => assignment.employeeRecordId),
      ),
    ),
  ];
  const occurrenceDates = collectAssessedOccurrenceDates(input.occurrences);
  const uniqueDates = [...new Set(occurrenceDates)].sort();
  if (uniqueDates.length === 0 || employeeRecordIds.length === 0) {
    return emptyPlanningAssessment();
  }

  const admin = createSupabaseAdminClient();
  const context = await loadAssessmentContext({ admin, orgId: input.orgId, employeeRecordIds, uniqueDates });
  if (!context) return null;
  const capacity = evaluateProposedCapacity({
    occurrences: input.occurrences,
    assignmentsFor,
    existingRows: context.existingRows,
    excludedOccurrenceIds: new Set([
      ...(input.excludeOccurrenceId ? [input.excludeOccurrenceId] : []),
      ...(input.excludeOccurrenceIds ?? []),
    ]),
    employeeRecordIds,
    uniqueDates,
    targets: context.targets,
  });

  const evaluations = await loadPlanningQualificationEvaluations({
    admin,
    orgId: input.orgId,
    jobId: input.jobId,
    assessments: buildQualificationAssessmentRequests(input.occurrences, assignmentsFor),
  });
  if (!evaluations) return null;
  return finishPlanningAssessment({ admin, capacity, evaluations, records: context.records });
}
