import 'server-only';

import { z } from 'zod';
import { parseIsoDateRange } from '@/lib/calendar/date-range';

import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import {
  getBusinessTodayIso,
  toEmploymentCondition,
  type EmploymentType,
} from '@/lib/personnel/types';
import { DEFAULT_DAILY_TARGET_MINUTES, resolveDailyTarget, type DailyTarget } from '@/lib/personnel/targets';
import {
  toCapabilityDefinition,
  toEmployeeCapability,
} from '@/lib/qualifications/server';
import { resolveAssignmentEvaluation } from '@/lib/qualifications/resolution';
import type {
  AssignmentCandidate,
  AssignmentEvaluation,
  EmployeeCapabilityRecord,
  JobCapabilityRequirement,
} from '@/lib/qualifications/types';
import { loadActiveSicknessSpansByRecord } from '@/lib/sickness/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { loadApprovedVacationSpansByRecord } from '@/lib/vacation/server';
import { readAllRows } from '@/lib/supabase/query-batches';
import { evaluateCapacity, fingerprintSnapshot } from './capacity';
import {
  addLocalDays,
  formatBerlinLocalDateTime,
  resolveBerlinWallTime,
  splitTimedIntervalByBerlinDate,
} from './date-time';
import type {
  CapacityDayContext,
  MaterializedOccurrence,
  PlanningAssignmentDraft,
  PlanningCalendarEntry,
  PlanningConflict,
} from './types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export type PlanningEmployeeOption = {
  employeeRecordId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
};

export type PlanningJobOption = {
  id: string;
  title: string;
  jobNumber: string | null;
  projectName: string | null;
};

export type PlanningTeamOption = {
  id: string;
  name: string;
};

export type PlanningAssessment = {
  conflicts: PlanningConflict[];
  assessmentFingerprint: string;
  capacitySnapshot: Record<string, unknown>;
  capacityFingerprint: string;
  qualificationSnapshot: Record<string, unknown>;
  qualificationFingerprint: string;
};

async function loadPlanningQualificationEvaluations(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string | null;
  assessments: Array<{
    localDate: string;
    employeeRecordIds: string[];
  }>;
}): Promise<AssignmentEvaluation[] | null> {
  const employeeRecordIds = [
    ...new Set(
      input.assessments.flatMap((assessment) => assessment.employeeRecordIds),
    ),
  ];
  if (employeeRecordIds.length === 0) return [];
  const latestDate = input.assessments
    .map((assessment) => assessment.localDate)
    .sort()
    .at(-1);
  if (!latestDate) return [];

  const [
    requirementsResult,
    settingsResult,
    employeesResult,
    conditionsResult,
  ] = await Promise.all([
    input.jobId
      ? input.admin
          .from('job_capability_requirements')
          .select('id, capability_id, require_confirmation')
          .eq('organization_id', input.orgId)
          .eq('job_id', input.jobId)
          .order('created_at')
          .limit(101)
      : Promise.resolve({ data: [], error: null }),
    input.admin
      .from('organization_qualification_settings')
      .select('apprentice_warning_enabled')
      .eq('organization_id', input.orgId)
      .maybeSingle(),
    input.admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', input.orgId)
      .in('id', employeeRecordIds)
      .limit(201),
    input.admin
      .from('employment_conditions')
      .select('employee_record_id, employment_type, valid_from')
      .eq('organization_id', input.orgId)
      .in('employee_record_id', employeeRecordIds)
      .lte('valid_from', latestDate)
      .order('valid_from', { ascending: false })
      .limit(5001),
  ]);
  if (
    requirementsResult.error ||
    settingsResult.error ||
    employeesResult.error ||
    conditionsResult.error ||
    (requirementsResult.data?.length ?? 0) > 100 ||
    (employeesResult.data?.length ?? 0) !== employeeRecordIds.length ||
    (conditionsResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }
  const capabilityIds = [
    ...new Set(
      (requirementsResult.data ?? []).map(
        (requirement) => requirement.capability_id,
      ),
    ),
  ];
  const userIds = (employeesResult.data ?? []).flatMap((employee) =>
    employee.user_id ? [employee.user_id] : [],
  );
  const [definitionsResult, recordsResult, profilesResult] = await Promise.all([
    capabilityIds.length
      ? input.admin
          .from('organization_capabilities')
          .select(
            'id, organization_id, kind, name, description, default_expiry_warning_days, retired_at',
          )
          .eq('organization_id', input.orgId)
          .in('id', capabilityIds)
          .is('retired_at', null)
          .limit(101)
      : Promise.resolve({ data: [], error: null }),
    capabilityIds.length
      ? input.admin
          .from('employee_capabilities')
          .select(
            'id, employee_record_id, capability_id, capability_kind, valid_from, valid_until, issuer, renewal_due_date, confirmation_status, evidence_state, operational_note, supersedes_id, superseded_at',
          )
          .eq('organization_id', input.orgId)
          .in('employee_record_id', employeeRecordIds)
          .in('capability_id', capabilityIds)
          .limit(5001)
      : Promise.resolve({ data: [], error: null }),
    userIds.length
      ? input.admin
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', userIds)
          .limit(201)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (
    definitionsResult.error ||
    recordsResult.error ||
    profilesResult.error ||
    (definitionsResult.data?.length ?? 0) > 100 ||
    (recordsResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }
  const definitions = new Map(
    (definitionsResult.data ?? []).map((definition) => [
      definition.id,
      toCapabilityDefinition(definition),
    ]),
  );
  const requirements: JobCapabilityRequirement[] = (
    requirementsResult.data ?? []
  ).flatMap((requirement) => {
    const definition = definitions.get(requirement.capability_id);
    return definition
      ? [
          {
            id: requirement.id,
            capabilityId: definition.id,
            capabilityName: definition.name,
            capabilityKind: definition.kind,
            requireConfirmation: requirement.require_confirmation,
          },
        ]
      : [];
  });
  const capabilityRecords = (recordsResult.data ?? []).map(
    toEmployeeCapability,
  );
  const capabilityRecordsByEmployee = new Map<
    string,
    EmployeeCapabilityRecord[]
  >();
  for (const record of capabilityRecords) {
    const records =
      capabilityRecordsByEmployee.get(record.employeeRecordId) ?? [];
    records.push(record);
    capabilityRecordsByEmployee.set(record.employeeRecordId, records);
  }
  const conditionsByEmployee = new Map<
    string,
    Array<{ validFrom: string; employmentType: EmploymentType }>
  >();
  for (const condition of conditionsResult.data ?? []) {
    const conditions =
      conditionsByEmployee.get(condition.employee_record_id) ?? [];
    conditions.push({
      validFrom: condition.valid_from,
      employmentType: condition.employment_type as EmploymentType,
    });
    conditionsByEmployee.set(condition.employee_record_id, conditions);
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  const employees = new Map(
    (employeesResult.data ?? []).map((employee) => [employee.id, employee]),
  );

  return input.assessments.map((assessment) => {
    const candidates: AssignmentCandidate[] =
      assessment.employeeRecordIds.flatMap((employeeRecordId) => {
        const employee = employees.get(employeeRecordId);
        if (!employee) return [];
        const condition = (conditionsByEmployee.get(employeeRecordId) ?? [])
          .filter((entry) => entry.validFrom <= assessment.localDate)
          .sort((left, right) =>
            right.validFrom.localeCompare(left.validFrom),
          )[0];
        const recordName = [employee.first_name, employee.last_name]
          .filter(Boolean)
          .join(' ');
        return [
          {
            userId: employee.user_id,
            employeeRecordId,
            displayName:
              (employee.user_id ? profileNames.get(employee.user_id) : null) ||
              recordName ||
              'Unbenannt',
            employmentType: condition?.employmentType ?? null,
            capabilityRecords:
              capabilityRecordsByEmployee.get(employeeRecordId) ?? [],
          },
        ];
      });
    return resolveAssignmentEvaluation({
      jobId: input.jobId,
      assessedForDate: assessment.localDate,
      candidates,
      requirements,
      apprenticeWarningEnabled:
        settingsResult.data?.apprentice_warning_enabled ?? false,
    });
  });
}

export async function loadPlanningOptions(orgId: string): Promise<{
  employees: PlanningEmployeeOption[];
  jobs: PlanningJobOption[];
  teams: PlanningTeamOption[];
} | null> {
  const admin = createSupabaseAdminClient();
  const [employeeResult, jobResult, teamResult] = await Promise.all([
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name, employee_number, exit_date')
      .eq('organization_id', orgId)
      .or(`exit_date.is.null,exit_date.gte.${getBusinessTodayIso()}`)
      .order('last_name')
      .limit(201),
    admin
      .from('jobs')
      .select('id, title, description, job_number, project_id')
      .eq('organization_id', orgId)
      .neq('status', 'fertig')
      .order('updated_at', { ascending: false })
      .limit(201),
    admin
      .from('teams')
      .select('id, name')
      .eq('organization_id', orgId)
      .is('dissolved_at', null)
      .order('name')
      .limit(101),
  ]);
  if (employeeResult.error || jobResult.error || teamResult.error) {
    console.error(
      'Failed to load planning options:',
      employeeResult.error ?? jobResult.error ?? teamResult.error,
    );
    return null;
  }
  if (
    (employeeResult.data?.length ?? 0) > 200 ||
    (jobResult.data?.length ?? 0) > 200 ||
    (teamResult.data?.length ?? 0) > 100
  ) {
    return null;
  }

  const projectIds = [
    ...new Set(
      (jobResult.data ?? []).flatMap((job) =>
        job.project_id ? [job.project_id] : [],
      ),
    ),
  ];
  // Linked records keep the profile as the authoritative name (P1-03); the
  // record's own name fields are only set for non-login personnel.
  const employeeUserIds = (employeeResult.data ?? []).flatMap((employee) =>
    employee.user_id ? [employee.user_id] : [],
  );
  const [projectResult, profileResult] = await Promise.all([
    projectIds.length
      ? admin
          .from('projects')
          .select('id, name')
          .eq('organization_id', orgId)
          .in('id', projectIds)
      : { data: [], error: null },
    employeeUserIds.length
      ? admin
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', employeeUserIds)
      : { data: [], error: null },
  ]);
  if (projectResult.error || profileResult.error) {
    console.error('Failed to load planning option references:', {
      code: (projectResult.error ?? profileResult.error)?.code ?? 'unknown',
    });
    return null;
  }
  const projectNames = new Map(
    (projectResult.data ?? []).map((project) => [project.id, project.name]),
  );
  const profileById = new Map(
    (profileResult.data ?? []).map((profile) => [profile.id, profile]),
  );

  return {
    employees: (employeeResult.data ?? []).map((employee) => {
      const profile = employee.user_id
        ? profileById.get(employee.user_id)
        : undefined;
      // Linked records: the profile is authoritative (P1-03); the record's own
      // fields only fill genuine gaps. Blank strings count as missing.
      const firstName = employee.user_id
        ? profile?.first_name?.trim() || employee.first_name?.trim() || ''
        : (employee.first_name?.trim() ?? '');
      const lastName = employee.user_id
        ? profile?.last_name?.trim() || employee.last_name?.trim() || ''
        : (employee.last_name?.trim() ?? '');
      return {
        employeeRecordId: employee.id,
        userId: employee.user_id,
        firstName,
        lastName,
        employeeNumber: employee.employee_number,
      };
    }),
    jobs: (jobResult.data ?? []).map((job) => ({
      id: job.id,
      title: job.title.trim() || job.description?.trim() || '—',
      jobNumber: job.job_number,
      projectName: job.project_id
        ? (projectNames.get(job.project_id) ?? null)
        : null,
    })),
    teams: teamResult.data ?? [],
  };
}

export async function expandPlanningTeamsForDates(input: {
  admin: AdminClient;
  orgId: string;
  teamIds: string[];
  localDates: string[];
}): Promise<Map<string, PlanningAssignmentDraft[]> | null> {
  const uniqueDates = [...new Set(input.localDates)].sort();
  const result = new Map<string, PlanningAssignmentDraft[]>();
  if (input.teamIds.length === 0 || uniqueDates.length === 0) return result;
  const { data, error } = await input.admin
    .from('team_memberships')
    .select('team_id, employee_record_id, valid_from, valid_until')
    .eq('organization_id', input.orgId)
    .in('team_id', [...new Set(input.teamIds)])
    .lte('valid_from', uniqueDates.at(-1)!)
    .or(`valid_until.is.null,valid_until.gte.${uniqueDates[0]}`)
    .limit(5001);
  if (error || (data?.length ?? 0) > 5000) return null;
  for (const localDate of uniqueDates) {
    result.set(
      localDate,
      (data ?? [])
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

function enumerateOccurrenceAllocations(
  occurrence: MaterializedOccurrence,
  employeeRecordIds: string[],
  targetByEmployeeDate: Map<string, ReturnType<typeof resolveDailyTarget>>,
): Array<{ employeeRecordId: string; localDate: string; minutes: number }> {
  if (
    occurrence.timeKind === 'timed' &&
    occurrence.startAt &&
    occurrence.endAt
  ) {
    const startAt = occurrence.startAt;
    const endAt = occurrence.endAt;
    return employeeRecordIds.flatMap((employeeRecordId) =>
      splitTimedIntervalByBerlinDate(new Date(startAt), new Date(endAt)).map(
        (allocation) => ({ employeeRecordId, ...allocation }),
      ),
    );
  }
  if (!occurrence.startDate || !occurrence.endDateExclusive) return [];
  const allocations: Array<{
    employeeRecordId: string;
    localDate: string;
    minutes: number;
  }> = [];
  for (
    let date = occurrence.startDate;
    date < occurrence.endDateExclusive;
    date = addLocalDays(date, 1)
  ) {
    for (const employeeRecordId of employeeRecordIds) {
      allocations.push({
        employeeRecordId,
        localDate: date,
        minutes:
          targetByEmployeeDate.get(`${employeeRecordId}:${date}`)
            ?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES,
      });
    }
  }
  return allocations;
}

type PendingVacationRow = {
  employee_record_id: string;
  start_date: string;
  end_date: string;
  day_portion: 'full' | 'half_day';
};

export type DailyTargetsByRecord = {
  /** Keyed by `${employeeRecordId}:${date}`. */
  targetByEmployeeDate: Map<string, DailyTarget>;
  pendingVacation: PendingVacationRow[];
};

/**
 * The per-person daily targets the P1-11 assessment and the P1-24a board read
 * share: schedules, employment conditions, holiday context, approved vacation
 * and sickness spans, plus the pending vacation requests that only warn.
 * One home, so a board cell and a planning warning can never disagree.
 */
export async function loadDailyTargetsByRecord(input: {
  admin: AdminClient;
  orgId: string;
  employeeRecordIds: string[];
  /** Sorted ISO dates; the first and last bound every read. */
  dates: string[];
}): Promise<DailyTargetsByRecord | null> {
  const windowStart = input.dates[0];
  const windowEnd = input.dates.at(-1);
  if (!windowStart || !windowEnd || input.employeeRecordIds.length === 0) {
    return { targetByEmployeeDate: new Map(), pendingVacation: [] };
  }
  const [schedulesResult, conditionsResult, calendar, vacationSpans, sicknessSpans, pendingVacationResult] =
    await Promise.all([
      input.admin
        .from('work_schedules')
        .select('*')
        .eq('organization_id', input.orgId)
        .in('employee_record_id', input.employeeRecordIds),
      input.admin
        .from('employment_conditions')
        .select('*')
        .eq('organization_id', input.orgId)
        .in('employee_record_id', input.employeeRecordIds),
      getCachedOrganizationCalendar(input.orgId),
      loadApprovedVacationSpansByRecord(input.orgId, windowStart, windowEnd),
      loadActiveSicknessSpansByRecord(input.orgId, windowStart, windowEnd),
      input.admin
        .from('vacation_requests')
        .select('employee_record_id, start_date, end_date, day_portion')
        .eq('organization_id', input.orgId)
        .eq('status', 'pending')
        .in('employee_record_id', input.employeeRecordIds)
        .lte('start_date', windowEnd)
        .gte('end_date', windowStart),
    ]);
  if (schedulesResult.error || conditionsResult.error || pendingVacationResult.error) return null;

  const schedulesByRecord = new Map<string, ReturnType<typeof toWorkSchedule>[]>();
  for (const row of schedulesResult.data ?? []) {
    const schedule = toWorkSchedule(row);
    const schedules = schedulesByRecord.get(schedule.employeeRecordId) ?? [];
    schedules.push(schedule);
    schedulesByRecord.set(schedule.employeeRecordId, schedules);
  }
  const conditionsByRecord = new Map<string, ReturnType<typeof toEmploymentCondition>[]>();
  for (const row of conditionsResult.data ?? []) {
    const condition = toEmploymentCondition(row);
    const conditions = conditionsByRecord.get(condition.employeeRecordId) ?? [];
    conditions.push(condition);
    conditionsByRecord.set(condition.employeeRecordId, conditions);
  }
  const targetByEmployeeDate = new Map<string, DailyTarget>();
  for (const employeeRecordId of input.employeeRecordIds) {
    for (const date of input.dates) {
      targetByEmployeeDate.set(
        `${employeeRecordId}:${date}`,
        resolveDailyTarget({
          dateIso: date,
          schedules: schedulesByRecord.get(employeeRecordId) ?? [],
          conditions: conditionsByRecord.get(employeeRecordId) ?? [],
          calendar,
          absences: [
            ...(vacationSpans.get(employeeRecordId) ?? []),
            ...(sicknessSpans.get(employeeRecordId) ?? []),
          ],
        }),
      );
    }
  }
  return { targetByEmployeeDate, pendingVacation: pendingVacationResult.data ?? [] };
}

export async function assessPlanningOccurrences(input: {
  orgId: string;
  jobId: string | null;
  occurrences: MaterializedOccurrence[];
  assignments: PlanningAssignmentDraft[];
  assignmentsByOriginalStartLocal?: ReadonlyMap<
    string,
    PlanningAssignmentDraft[]
  >;
  excludeOccurrenceId?: string;
  excludeOccurrenceIds?: string[];
}): Promise<PlanningAssessment | null> {
  const assignmentsFor = (
    occurrence: MaterializedOccurrence,
  ): PlanningAssignmentDraft[] => [
    ...new Map(
      (input.assignmentsByOriginalStartLocal
        ? (input.assignmentsByOriginalStartLocal.get(
            occurrence.originalStartLocal,
          ) ?? [])
        : input.assignments
      ).map((assignment) => [assignment.employeeRecordId, assignment]),
    ).values(),
  ];
  const employeeRecordIds = [
    ...new Set(
      input.occurrences.flatMap((occurrence) =>
        assignmentsFor(occurrence).map(
          (assignment) => assignment.employeeRecordId,
        ),
      ),
    ),
  ];
  const occurrenceDates = input.occurrences.flatMap((occurrence) => {
    if (
      occurrence.timeKind === 'timed' &&
      occurrence.startAt &&
      occurrence.endAt
    ) {
      return splitTimedIntervalByBerlinDate(
        new Date(occurrence.startAt),
        new Date(occurrence.endAt),
      ).map((allocation) => allocation.localDate);
    }
    if (!occurrence.startDate || !occurrence.endDateExclusive) return [];
    const dates: string[] = [];
    for (
      let date = occurrence.startDate;
      date < occurrence.endDateExclusive;
      date = addLocalDays(date, 1)
    ) {
      dates.push(date);
    }
    return dates;
  });
  const uniqueDates = [...new Set(occurrenceDates)].sort();
  if (uniqueDates.length === 0 || employeeRecordIds.length === 0) {
    const capacitySnapshot = { employeeDays: [], conflicts: [] };
    const qualificationSnapshot = { evaluations: [] };
    const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
    const qualificationFingerprint = await fingerprintSnapshot(
      qualificationSnapshot,
    );
    return {
      conflicts: [],
      assessmentFingerprint: await fingerprintSnapshot({
        capacityFingerprint,
        qualificationFingerprint,
      }),
      capacitySnapshot,
      capacityFingerprint,
      qualificationSnapshot,
      qualificationFingerprint,
    };
  }

  const windowStart = uniqueDates[0];
  if (!windowStart) return null;
  const windowEnd = uniqueDates.at(-1) ?? windowStart;
  const windowStartInstant = resolveBerlinWallTime(`${windowStart}T00:00`);
  const windowEndInstant = resolveBerlinWallTime(
    `${addLocalDays(windowEnd, 1)}T00:00`,
  );
  if (!windowStartInstant || !windowEndInstant) return null;
  const admin = createSupabaseAdminClient();
  const [recordsResult, targets, existingOccurrenceResult] = await Promise.all([
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', input.orgId)
      .in('id', employeeRecordIds),
    loadDailyTargetsByRecord({ admin, orgId: input.orgId, employeeRecordIds, dates: uniqueDates }),
    admin
      .from('planning_occurrences')
      .select(
        'id, time_kind, start_at, end_at, start_date, end_date_exclusive, status',
      )
      .eq('organization_id', input.orgId)
      .eq('status', 'scheduled')
      .or(
        `and(start_at.lt.${windowEndInstant.instant.toISOString()},end_at.gt.${windowStartInstant.instant.toISOString()}),and(start_date.lte.${windowEnd},end_date_exclusive.gt.${windowStart})`,
      )
      .limit(5001),
  ]);
  if (
    recordsResult.error ||
    !targets ||
    existingOccurrenceResult.error ||
    recordsResult.data?.length !== employeeRecordIds.length ||
    (existingOccurrenceResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }
  const { targetByEmployeeDate, pendingVacation } = targets;

  const excludedOccurrenceIds = new Set([
    ...(input.excludeOccurrenceId ? [input.excludeOccurrenceId] : []),
    ...(input.excludeOccurrenceIds ?? []),
  ]);
  const existingOccurrences = (existingOccurrenceResult.data ?? []).filter(
    (occurrence) => !excludedOccurrenceIds.has(occurrence.id),
  );
  const existingOccurrenceIds = existingOccurrences.map(
    (occurrence) => occurrence.id,
  );
  const existingAssignmentsResult = existingOccurrenceIds.length
    ? await admin
        .from('planning_occurrence_assignments')
        .select('occurrence_id, employee_record_id')
        .eq('organization_id', input.orgId)
        .in('occurrence_id', existingOccurrenceIds)
        .in('employee_record_id', employeeRecordIds)
        .limit(5001)
    : { data: [], error: null };
  if (
    existingAssignmentsResult.error ||
    (existingAssignmentsResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }
  const assignmentRecordsByOccurrence = new Map<string, string[]>();
  for (const assignment of existingAssignmentsResult.data ?? []) {
    const records =
      assignmentRecordsByOccurrence.get(assignment.occurrence_id) ?? [];
    records.push(assignment.employee_record_id);
    assignmentRecordsByOccurrence.set(assignment.occurrence_id, records);
  }
  const existingMinutes = new Map<string, number>();
  const overlaps = new Map<string, number>();
  const proposedTimedByEmployee = new Map<
    string,
    Array<{ start: number; end: number }>
  >();
  const proposedAllDayEmployeeDates = new Set<string>();
  for (const occurrence of input.occurrences) {
    if (occurrence.startAt && occurrence.endAt) {
      for (const assignment of assignmentsFor(occurrence)) {
        const intervals =
          proposedTimedByEmployee.get(assignment.employeeRecordId) ?? [];
        intervals.push({
          start: new Date(occurrence.startAt).getTime(),
          end: new Date(occurrence.endAt).getTime(),
        });
        proposedTimedByEmployee.set(assignment.employeeRecordId, intervals);
      }
      continue;
    }
    if (!occurrence.startDate || !occurrence.endDateExclusive) continue;
    for (
      let date = occurrence.startDate;
      date < occurrence.endDateExclusive;
      date = addLocalDays(date, 1)
    ) {
      for (const assignment of assignmentsFor(occurrence)) {
        proposedAllDayEmployeeDates.add(
          `${assignment.employeeRecordId}:${date}`,
        );
      }
    }
  }
  const existingTimedByEmployee = new Map<
    string,
    Array<{ start: number; end: number }>
  >();
  for (const existing of existingOccurrences) {
    const records = assignmentRecordsByOccurrence.get(existing.id) ?? [];
    if (
      existing.time_kind === 'timed' &&
      existing.start_at &&
      existing.end_at
    ) {
      const allocations = splitTimedIntervalByBerlinDate(
        new Date(existing.start_at),
        new Date(existing.end_at),
      );
      for (const employeeRecordId of records) {
        for (const allocation of allocations) {
          const key = `${employeeRecordId}:${allocation.localDate}`;
          existingMinutes.set(
            key,
            (existingMinutes.get(key) ?? 0) + allocation.minutes,
          );
          if (proposedAllDayEmployeeDates.has(key)) {
            overlaps.set(key, (overlaps.get(key) ?? 0) + allocation.minutes);
          }
        }
        const intervals = existingTimedByEmployee.get(employeeRecordId) ?? [];
        intervals.push({
          start: new Date(existing.start_at).getTime(),
          end: new Date(existing.end_at).getTime(),
        });
        existingTimedByEmployee.set(employeeRecordId, intervals);
      }
    } else if (existing.start_date && existing.end_date_exclusive) {
      for (
        let date = existing.start_date;
        date < existing.end_date_exclusive;
        date = addLocalDays(date, 1)
      ) {
        for (const employeeRecordId of records) {
          const key = `${employeeRecordId}:${date}`;
          existingMinutes.set(
            key,
            (existingMinutes.get(key) ?? 0) +
              (targetByEmployeeDate.get(key)?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES),
          );
          overlaps.set(
            key,
            (overlaps.get(key) ?? 0) +
              Math.max(1, targetByEmployeeDate.get(key)?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES),
          );
        }
      }
    }
  }

  for (const [employeeRecordId, existingIntervals] of existingTimedByEmployee) {
    const proposedIntervals = proposedTimedByEmployee.get(employeeRecordId);
    if (!proposedIntervals?.length) continue;
    existingIntervals.sort((left, right) => left.start - right.start);
    proposedIntervals.sort((left, right) => left.start - right.start);
    let proposedCursor = 0;
    let activeProposals: Array<{ start: number; end: number }> = [];
    for (const existing of existingIntervals) {
      activeProposals = activeProposals.filter(
        (proposed) => proposed.end > existing.start,
      );
      let proposed = proposedIntervals[proposedCursor];
      while (proposed && proposed.start < existing.end) {
        if (proposed.end > existing.start) activeProposals.push(proposed);
        proposedCursor += 1;
        proposed = proposedIntervals[proposedCursor];
      }
      for (const proposed of activeProposals) {
        const overlapStart = new Date(Math.max(existing.start, proposed.start));
        const overlapEnd = new Date(Math.min(existing.end, proposed.end));
        for (const allocation of splitTimedIntervalByBerlinDate(
          overlapStart,
          overlapEnd,
        )) {
          const key = `${employeeRecordId}:${allocation.localDate}`;
          overlaps.set(key, (overlaps.get(key) ?? 0) + allocation.minutes);
        }
      }
    }
  }

  const contexts: CapacityDayContext[] = [];
  const missingConfigurationConflicts: PlanningConflict[] = [];
  const proposed = input.occurrences.flatMap((occurrence) =>
    enumerateOccurrenceAllocations(
      occurrence,
      assignmentsFor(occurrence).map(
        (assignment) => assignment.employeeRecordId,
      ),
      targetByEmployeeDate,
    ),
  );
  const proposedKeys = new Set(
    proposed.map(
      (allocation) => `${allocation.employeeRecordId}:${allocation.localDate}`,
    ),
  );
  for (const employeeRecordId of employeeRecordIds) {
    for (const date of uniqueDates) {
      const key = `${employeeRecordId}:${date}`;
      if (!proposedKeys.has(key)) continue;
      const target = targetByEmployeeDate.get(key);
      if (!target) continue;
      const pending = pendingVacation.filter(
        (request) =>
          request.employee_record_id === employeeRecordId &&
          request.start_date <= date &&
          date <= request.end_date,
      );
      if (target.source === 'default') {
        missingConfigurationConflicts.push({
          kind: 'no_schedule',
          severity: 'warning',
          employeeRecordId,
          localDate: date,
          message:
            'Für diese Person gilt nur der gekennzeichnete Standardwert, weil kein Arbeitszeitmodell hinterlegt ist.',
          details: { fallbackMinutes: target.baseTargetMinutes },
        });
      }
      contexts.push({
        employeeRecordId,
        localDate: date,
        targetMinutes:
          target.isHoliday || target.isClosureDay
            ? 0
            : target.baseTargetMinutes,
        targetSource: target.isClosureDay
          ? 'closure'
          : target.isHoliday
            ? 'holiday'
            : target.source,
        approvedAbsenceMinutes: Math.max(
          0,
          target.baseTargetMinutes - target.targetMinutes,
        ),
        pendingAbsenceMinutes: pending.reduce(
          (minutes, request) =>
            Math.max(
              minutes,
              request.day_portion === 'full'
                ? target.baseTargetMinutes
                : Math.round(target.baseTargetMinutes / 2),
            ),
          0,
        ),
        existingPlannedMinutes: existingMinutes.get(key) ?? 0,
        overlapMinutes: overlaps.get(key) ?? 0,
      });
    }
  }
  const capacity = evaluateCapacity(proposed, contexts);
  capacity.conflicts.unshift(...missingConfigurationConflicts);

  const evaluations = await loadPlanningQualificationEvaluations({
    admin,
    orgId: input.orgId,
    jobId: input.jobId,
    assessments: input.occurrences.flatMap((occurrence) => {
      const employeeIds = assignmentsFor(occurrence).map(
        (assignment) => assignment.employeeRecordId,
      );
      if (!employeeIds.length) return [];
      const localDates =
        occurrence.timeKind === 'timed' &&
        occurrence.startAt &&
        occurrence.endAt
          ? splitTimedIntervalByBerlinDate(
              new Date(occurrence.startAt),
              new Date(occurrence.endAt),
            ).map((allocation) => allocation.localDate)
          : occurrence.startDate && occurrence.endDateExclusive
            ? (() => {
                const dates: string[] = [];
                for (
                  let date = occurrence.startDate;
                  date < occurrence.endDateExclusive;
                  date = addLocalDays(date, 1)
                ) {
                  dates.push(date);
                }
                return dates;
              })()
            : [];
      return [...new Set(localDates)].map((localDate) => ({
        localDate,
        employeeRecordIds: employeeIds,
      }));
    }),
  });
  if (!evaluations) return null;
  const qualificationConflicts: PlanningConflict[] = evaluations
    .filter((evaluation) => evaluation.requiresOverride)
    .map((evaluation) => ({
      kind: 'qualification',
      severity: 'warning',
      employeeRecordId: null,
      localDate: evaluation.assessedForDate,
      message:
        'Die Qualifikationsanforderungen des Auftrags sind nicht vollständig abgedeckt.',
      details: { fingerprint: evaluation.fingerprint },
    }));
  const capacitySnapshot = {
    employeeDays: capacity.employeeDays,
    conflicts: capacity.conflicts,
  };
  const qualificationSnapshot = { evaluations };
  const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
  const qualificationFingerprint = await fingerprintSnapshot(
    qualificationSnapshot,
  );
  // Warnings must explain the affected person, not only the date. The name is
  // attached AFTER fingerprinting so snapshots and fingerprints stay
  // name-independent (a later rename never invalidates a stored assessment).
  // Member-linked records carry their names on the profile, so resolution
  // follows the same precedence as the planning pickers.
  const conflictUserIds = (recordsResult.data ?? []).flatMap((record) =>
    record.user_id ? [record.user_id as string] : [],
  );
  const conflictProfilesResult = conflictUserIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', conflictUserIds)
        .limit(201)
    : { data: [], error: null };
  if (conflictProfilesResult.error) return null;
  const profileNameByUserId = new Map(
    (conflictProfilesResult.data ?? []).map((profile) => [
      profile.id as string,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim(),
    ]),
  );
  const nameByRecordId = new Map(
    (recordsResult.data ?? []).map((record) => {
      const profileName = record.user_id
        ? profileNameByUserId.get(record.user_id as string)
        : null;
      const recordName = [record.first_name, record.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      return [record.id as string, profileName || recordName || null];
    }),
  );
  const withEmployeeName = (conflict: PlanningConflict): PlanningConflict => ({
    ...conflict,
    employeeName: conflict.employeeRecordId
      ? (nameByRecordId.get(conflict.employeeRecordId) ?? null)
      : null,
  });
  return {
    conflicts: [...capacity.conflicts, ...qualificationConflicts].map(
      withEmployeeName,
    ),
    assessmentFingerprint: await fingerprintSnapshot({
      capacityFingerprint,
      qualificationFingerprint,
    }),
    capacitySnapshot,
    capacityFingerprint,
    qualificationSnapshot,
    qualificationFingerprint,
  };
}

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
      client: z.object({ id: z.string(), name: z.string(), address: z.string().nullable() }).nullable(),
      project: z.object({ id: z.string(), name: z.string(), project_number: z.string().nullable() }).nullable(),
    })
    .nullable(),
});

const CALENDAR_OCCURRENCE_SELECT = [
  'id, series_id, series_lineage_id, job_id, entry_kind, internal_type, time_kind, status, is_exception, title, description, location, start_at, end_at, start_date, end_date_exclusive, version',
  'assignments:planning_occurrence_assignments(employee_record_id, employee_records(user_id))',
  'job:jobs!planning_occurrences_job_id_fkey(id, title, description, job_number, status, priority, location, execution_version, client:clients(id, name, address), project:projects(id, name, project_number))',
].join(', ');

/** Assignments per window; the former batched loader kept the same bound. */
const CALENDAR_ASSIGNMENT_CAP = 10_000;

/**
 * The calendar window in two paged requests at most (Step 2, PF-08, PF-23,
 * PF-25): occurrences embed their assignments, job, client, and project
 * through PostgREST relations instead of the former dependent stages with
 * batched id lists. Employees read only occurrences they are assigned to
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
    if (recordError) return null;
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
      // Skipped/cancelled occurrences stay traceably visible in the calendar
      // (P1-11-F03); overlap/capacity checks keep their own scheduled-only query.
      .in('status', ['scheduled', 'skipped', 'cancelled'])
      .or(
        `and(start_at.lt.${toInstant.instant.toISOString()},end_at.gt.${fromInstant.instant.toISOString()}),and(start_date.lte.${input.to},end_date_exclusive.gt.${input.from})`,
      );
    if (ownRecordId) query = query.eq('own.employee_record_id', ownRecordId);
    return query
      .order('start_at', { ascending: true, nullsFirst: false })
      .order('id');
  };
  // Paged complete read up to the declared cap: a single request returns at
  // most the project's `max_rows` (1,000) and would silently drop the rest of
  // a dense month (PF-25). An overflow stays an explicit null.
  const { data: rows, error, overflow } = await readAllRows<unknown, { message: string }>(
    (from, to) => windowQuery().range(from, to),
    { cap: 2000 },
  );
  if (error || overflow) {
    if (error) console.error('Failed to load planning calendar window:', { message: error.message });
    if (overflow) console.error('Planning calendar window exceeded its row cap:', { organizationId: input.orgId, from: input.from, to: input.to });
    return null;
  }
  const parsed = z.array(calendarOccurrenceRowSchema).safeParse(rows);
  if (!parsed.success) {
    console.error('Planning calendar window rows did not match the expected shape.');
    return null;
  }
  const occurrences = parsed.data;
  const assignmentCount = occurrences.reduce((total, row) => total + row.assignments.length, 0);
  if (assignmentCount > CALENDAR_ASSIGNMENT_CAP) return null;

  return occurrences.flatMap((occurrence) => {
    const job = occurrence.job;
    if (job?.status === 'geparkt') return [];
    const records = occurrence.assignments.map((assignment) => assignment.employee_record_id);
    const startLocal = occurrence.start_at
      ? formatBerlinLocalDateTime(occurrence.start_at)
      : null;
    return [
      {
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
        title:
          job?.title.trim() ||
          job?.description?.trim() ||
          occurrence.title ||
          '—',
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
                (new Date(occurrence.end_at).getTime() -
                  new Date(occurrence.start_at).getTime()) /
                  60_000,
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
        priority: job?.priority ?? null,
        clientName: job?.client?.name ?? null,
        clientAddress: job?.client?.address ?? null,
        projectName: job?.project?.name ?? null,
        projectNumber: job?.project?.project_number ?? null,
      },
    ];
  });
}
