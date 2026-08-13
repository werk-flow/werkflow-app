import 'server-only';

import { getCachedOrganizationCalendar } from '@/lib/data/cached';
import { toWorkSchedule } from '@/lib/personnel/schedule';
import {
  getBusinessTodayIso,
  toEmploymentCondition,
  type EmploymentType,
} from '@/lib/personnel/types';
import { resolveDailyTarget } from '@/lib/personnel/targets';
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
      input.assessments.flatMap((assessment) => assessment.employeeRecordIds)
    ),
  ];
  if (employeeRecordIds.length === 0) return [];
  const latestDate = input.assessments
    .map((assessment) => assessment.localDate)
    .sort()
    .at(-1);
  if (!latestDate) return [];

  const [requirementsResult, settingsResult, employeesResult, conditionsResult] =
    await Promise.all([
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
        (requirement) => requirement.capability_id
      )
    ),
  ];
  const userIds = (employeesResult.data ?? []).flatMap((employee) =>
    employee.user_id ? [employee.user_id] : []
  );
  const [definitionsResult, recordsResult, profilesResult] = await Promise.all([
    capabilityIds.length
      ? input.admin
          .from('organization_capabilities')
          .select('id, organization_id, kind, name, description, default_expiry_warning_days, retired_at')
          .eq('organization_id', input.orgId)
          .in('id', capabilityIds)
          .is('retired_at', null)
          .limit(101)
      : Promise.resolve({ data: [], error: null }),
    capabilityIds.length
      ? input.admin
          .from('employee_capabilities')
          .select('id, employee_record_id, capability_id, capability_kind, valid_from, valid_until, issuer, renewal_due_date, confirmation_status, evidence_state, operational_note, supersedes_id, superseded_at')
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
    ])
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
    toEmployeeCapability
  );
  const capabilityRecordsByEmployee = new Map<
    string,
    EmployeeCapabilityRecord[]
  >();
  for (const record of capabilityRecords) {
    const records = capabilityRecordsByEmployee.get(record.employeeRecordId) ?? [];
    records.push(record);
    capabilityRecordsByEmployee.set(record.employeeRecordId, records);
  }
  const conditionsByEmployee = new Map<
    string,
    Array<{ validFrom: string; employmentType: EmploymentType }>
  >();
  for (const condition of conditionsResult.data ?? []) {
    const conditions = conditionsByEmployee.get(condition.employee_record_id) ?? [];
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
    ])
  );
  const employees = new Map(
    (employeesResult.data ?? []).map((employee) => [employee.id, employee])
  );

  return input.assessments.map((assessment) => {
    const candidates: AssignmentCandidate[] = assessment.employeeRecordIds.flatMap(
      (employeeRecordId) => {
        const employee = employees.get(employeeRecordId);
        if (!employee) return [];
        const condition = (conditionsByEmployee.get(employeeRecordId) ?? [])
          .filter((entry) => entry.validFrom <= assessment.localDate)
          .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
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
      }
    );
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

export async function loadPlanningOptions(
  orgId: string
): Promise<{
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
      employeeResult.error ?? jobResult.error ?? teamResult.error
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
        job.project_id ? [job.project_id] : []
      )
    ),
  ];
  const projectResult = projectIds.length
    ? await admin
        .from('projects')
        .select('id, name')
        .eq('organization_id', orgId)
        .in('id', projectIds)
    : { data: [], error: null };
  if (projectResult.error) return null;
  const projectNames = new Map(
    (projectResult.data ?? []).map((project) => [project.id, project.name])
  );

  return {
    employees: (employeeResult.data ?? []).map((employee) => ({
      employeeRecordId: employee.id,
      userId: employee.user_id,
      firstName: employee.first_name ?? '',
      lastName: employee.last_name ?? '',
      employeeNumber: employee.employee_number,
    })),
    jobs: (jobResult.data ?? []).map((job) => ({
      id: job.id,
      title: job.title.trim() || job.description?.trim() || '—',
      jobNumber: job.job_number,
      projectName: job.project_id
        ? projectNames.get(job.project_id) ?? null
        : null,
    })),
    teams: teamResult.data ?? [],
  };
}

export async function expandPlanningTeams(input: {
  admin: AdminClient;
  orgId: string;
  teamIds: string[];
  localDate: string;
}): Promise<PlanningAssignmentDraft[] | null> {
  if (input.teamIds.length === 0) return [];
  const { data, error } = await input.admin
    .from('team_memberships')
    .select('team_id, employee_record_id, valid_from, valid_until')
    .eq('organization_id', input.orgId)
    .in('team_id', [...new Set(input.teamIds)])
    .lte('valid_from', input.localDate)
    .or(`valid_until.is.null,valid_until.gte.${input.localDate}`)
    .limit(1001);
  if (error || (data?.length ?? 0) > 1000) return null;
  return (data ?? []).map((membership) => ({
    employeeRecordId: membership.employee_record_id,
    teamSourceId: membership.team_id,
  }));
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
            (!membership.valid_until || localDate <= membership.valid_until)
        )
        .map((membership) => ({
          employeeRecordId: membership.employee_record_id,
          teamSourceId: membership.team_id,
        }))
    );
  }
  return result;
}

function enumerateOccurrenceAllocations(
  occurrence: MaterializedOccurrence,
  employeeRecordIds: string[],
  targetByEmployeeDate: Map<string, ReturnType<typeof resolveDailyTarget>>
): Array<{ employeeRecordId: string; localDate: string; minutes: number }> {
  if (occurrence.timeKind === 'timed' && occurrence.startAt && occurrence.endAt) {
    const startAt = occurrence.startAt;
    const endAt = occurrence.endAt;
    return employeeRecordIds.flatMap((employeeRecordId) =>
      splitTimedIntervalByBerlinDate(
        new Date(startAt),
        new Date(endAt)
      ).map((allocation) => ({ employeeRecordId, ...allocation }))
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
            ?.targetMinutes ?? 480,
      });
    }
  }
  return allocations;
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
    occurrence: MaterializedOccurrence
  ): PlanningAssignmentDraft[] => [
    ...new Map(
      (input.assignmentsByOriginalStartLocal
        ? input.assignmentsByOriginalStartLocal.get(
            occurrence.originalStartLocal
          ) ?? []
        : input.assignments
      ).map((assignment) => [assignment.employeeRecordId, assignment])
    ).values(),
  ];
  const employeeRecordIds = [
    ...new Set(
      input.occurrences.flatMap((occurrence) =>
        assignmentsFor(occurrence).map(
          (assignment) => assignment.employeeRecordId
        )
      )
    ),
  ];
  const occurrenceDates = input.occurrences.flatMap((occurrence) => {
    if (occurrence.timeKind === 'timed' && occurrence.startAt && occurrence.endAt) {
      return splitTimedIntervalByBerlinDate(
        new Date(occurrence.startAt),
        new Date(occurrence.endAt)
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
      qualificationSnapshot
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
  const windowEnd = uniqueDates.at(-1) ?? windowStart;
  const windowStartInstant = resolveBerlinWallTime(`${windowStart}T00:00`);
  const windowEndInstant = resolveBerlinWallTime(
    `${addLocalDays(windowEnd, 1)}T00:00`
  );
  if (!windowStartInstant || !windowEndInstant) return null;
  const admin = createSupabaseAdminClient();
  const [
    recordsResult,
    schedulesResult,
    conditionsResult,
    calendar,
    vacationSpans,
    sicknessSpans,
    pendingVacationResult,
    existingOccurrenceResult,
  ] = await Promise.all([
    admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', input.orgId)
      .in('id', employeeRecordIds),
    admin
      .from('work_schedules')
      .select('*')
      .eq('organization_id', input.orgId)
      .in('employee_record_id', employeeRecordIds),
    admin
      .from('employment_conditions')
      .select('*')
      .eq('organization_id', input.orgId)
      .in('employee_record_id', employeeRecordIds),
    getCachedOrganizationCalendar(input.orgId),
    loadApprovedVacationSpansByRecord(input.orgId, windowStart, windowEnd),
    loadActiveSicknessSpansByRecord(input.orgId, windowStart, windowEnd),
    admin
      .from('vacation_requests')
      .select('employee_record_id, start_date, end_date, day_portion')
      .eq('organization_id', input.orgId)
      .eq('status', 'pending')
      .in('employee_record_id', employeeRecordIds)
      .lte('start_date', windowEnd)
      .gte('end_date', windowStart),
    admin
      .from('planning_occurrences')
      .select('id, time_kind, start_at, end_at, start_date, end_date_exclusive, status')
      .eq('organization_id', input.orgId)
      .eq('status', 'scheduled')
      .or(
        `and(start_at.lt.${windowEndInstant.instant.toISOString()},end_at.gt.${windowStartInstant.instant.toISOString()}),and(start_date.lte.${windowEnd},end_date_exclusive.gt.${windowStart})`
      )
      .limit(5001),
  ]);
  if (
    recordsResult.error ||
    schedulesResult.error ||
    conditionsResult.error ||
    pendingVacationResult.error ||
    existingOccurrenceResult.error ||
    recordsResult.data?.length !== employeeRecordIds.length ||
    (existingOccurrenceResult.data?.length ?? 0) > 5000
  ) {
    return null;
  }

  const schedulesByRecord = new Map<string, ReturnType<typeof toWorkSchedule>[]>();
  for (const row of schedulesResult.data ?? []) {
    const schedule = toWorkSchedule(row);
    const schedules = schedulesByRecord.get(schedule.employeeRecordId) ?? [];
    schedules.push(schedule);
    schedulesByRecord.set(schedule.employeeRecordId, schedules);
  }
  const conditionsByRecord = new Map<
    string,
    ReturnType<typeof toEmploymentCondition>[]
  >();
  for (const row of conditionsResult.data ?? []) {
    const condition = toEmploymentCondition(row);
    const conditions = conditionsByRecord.get(condition.employeeRecordId) ?? [];
    conditions.push(condition);
    conditionsByRecord.set(condition.employeeRecordId, conditions);
  }

  const targetByEmployeeDate = new Map<
    string,
    ReturnType<typeof resolveDailyTarget>
  >();
  for (const employeeRecordId of employeeRecordIds) {
    for (const date of uniqueDates) {
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
        })
      );
    }
  }

  const excludedOccurrenceIds = new Set([
    ...(input.excludeOccurrenceId ? [input.excludeOccurrenceId] : []),
    ...(input.excludeOccurrenceIds ?? []),
  ]);
  const existingOccurrences = (existingOccurrenceResult.data ?? []).filter(
    (occurrence) => !excludedOccurrenceIds.has(occurrence.id)
  );
  const existingOccurrenceIds = existingOccurrences.map(
    (occurrence) => occurrence.id
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
    const records = assignmentRecordsByOccurrence.get(assignment.occurrence_id) ?? [];
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
          `${assignment.employeeRecordId}:${date}`
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
    if (existing.time_kind === 'timed' && existing.start_at && existing.end_at) {
      const allocations = splitTimedIntervalByBerlinDate(
        new Date(existing.start_at),
        new Date(existing.end_at)
      );
      for (const employeeRecordId of records) {
        for (const allocation of allocations) {
          const key = `${employeeRecordId}:${allocation.localDate}`;
          existingMinutes.set(key, (existingMinutes.get(key) ?? 0) + allocation.minutes);
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
      for (let date = existing.start_date; date < existing.end_date_exclusive; date = addLocalDays(date, 1)) {
        for (const employeeRecordId of records) {
          const key = `${employeeRecordId}:${date}`;
          existingMinutes.set(
            key,
            (existingMinutes.get(key) ?? 0) +
              (targetByEmployeeDate.get(key)?.targetMinutes ?? 480)
          );
          overlaps.set(
            key,
            (overlaps.get(key) ?? 0) +
              Math.max(1, targetByEmployeeDate.get(key)?.targetMinutes ?? 480)
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
        (proposed) => proposed.end > existing.start
      );
      while (
        proposedCursor < proposedIntervals.length &&
        proposedIntervals[proposedCursor].start < existing.end
      ) {
        const proposed = proposedIntervals[proposedCursor];
        if (proposed.end > existing.start) activeProposals.push(proposed);
        proposedCursor += 1;
      }
      for (const proposed of activeProposals) {
        const overlapStart = new Date(Math.max(existing.start, proposed.start));
        const overlapEnd = new Date(Math.min(existing.end, proposed.end));
        for (const allocation of splitTimedIntervalByBerlinDate(
          overlapStart,
          overlapEnd
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
        (assignment) => assignment.employeeRecordId
      ),
      targetByEmployeeDate
    )
  );
  const proposedKeys = new Set(
    proposed.map(
      (allocation) =>
        `${allocation.employeeRecordId}:${allocation.localDate}`
    )
  );
  for (const employeeRecordId of employeeRecordIds) {
    for (const date of uniqueDates) {
      const key = `${employeeRecordId}:${date}`;
      if (!proposedKeys.has(key)) continue;
      const target = targetByEmployeeDate.get(key);
      if (!target) continue;
      const pending = (pendingVacationResult.data ?? []).filter(
        (request) =>
          request.employee_record_id === employeeRecordId &&
          request.start_date <= date &&
          date <= request.end_date
      );
      if (target.source === 'default') {
        missingConfigurationConflicts.push({
          kind: 'no_schedule',
          severity: 'warning',
          employeeRecordId,
          localDate: date,
          message: 'Für diese Person gilt nur der gekennzeichnete Standardwert, weil kein Arbeitszeitmodell hinterlegt ist.',
          details: { fallbackMinutes: target.baseTargetMinutes },
        });
      }
      contexts.push({
        employeeRecordId,
        localDate: date,
        targetMinutes:
          target.isHoliday || target.isClosureDay ? 0 : target.baseTargetMinutes,
        targetSource: target.isClosureDay
          ? 'closure'
          : target.isHoliday
            ? 'holiday'
            : target.source,
        approvedAbsenceMinutes: Math.max(0, target.baseTargetMinutes - target.targetMinutes),
        pendingAbsenceMinutes: pending.reduce(
          (minutes, request) =>
            Math.max(
              minutes,
              request.day_portion === 'full'
                ? target.baseTargetMinutes
                : Math.round(target.baseTargetMinutes / 2)
            ),
          0
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
        (assignment) => assignment.employeeRecordId
      );
      if (!employeeIds.length) return [];
      const localDates =
        occurrence.timeKind === 'timed' && occurrence.startAt && occurrence.endAt
          ? splitTimedIntervalByBerlinDate(
              new Date(occurrence.startAt),
              new Date(occurrence.endAt)
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
      message: 'Die Qualifikationsanforderungen des Auftrags sind nicht vollständig abgedeckt.',
      details: { fingerprint: evaluation.fingerprint },
    }));
  const capacitySnapshot = {
    employeeDays: capacity.employeeDays,
    conflicts: capacity.conflicts,
  };
  const qualificationSnapshot = { evaluations };
  const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
  const qualificationFingerprint = await fingerprintSnapshot(
    qualificationSnapshot
  );
  return {
    conflicts: [...capacity.conflicts, ...qualificationConflicts],
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

async function loadCalendarAssignments(input: {
  admin: AdminClient;
  orgId: string;
  occurrenceIds: string[];
  employeeRecordId?: string;
}): Promise<
  Array<{ occurrence_id: string; employee_record_id: string }> | null
> {
  const results = await Promise.all(
    Array.from(
      { length: Math.ceil(input.occurrenceIds.length / 100) },
      (_, index) => {
        let query = input.admin
          .from('planning_occurrence_assignments')
          .select('occurrence_id, employee_record_id')
          .eq('organization_id', input.orgId)
          .in(
            'occurrence_id',
            input.occurrenceIds.slice(index * 100, index * 100 + 100)
          )
          .limit(10_001);
        if (input.employeeRecordId) {
          query = query.eq('employee_record_id', input.employeeRecordId);
        }
        return query;
      }
    )
  );
  if (results.some((result) => result.error)) return null;
  const assignments = results.flatMap((result) => result.data ?? []);
  return assignments.length > 10_000 ? null : assignments;
}

export async function loadPlanningCalendarEntries(input: {
  orgId: string;
  userId: string;
  isManager: boolean;
  from: string;
  to: string;
}): Promise<PlanningCalendarEntry[] | null> {
  const admin = createSupabaseAdminClient();
  const fromInstant = resolveBerlinWallTime(`${input.from}T00:00`);
  const toInstant = resolveBerlinWallTime(`${addLocalDays(input.to, 1)}T00:00`);
  if (!fromInstant || !toInstant) return null;
  const query = admin
    .from('planning_occurrences')
    .select('id, series_id, series_lineage_id, job_id, entry_kind, internal_type, time_kind, status, is_exception, title, description, location, start_at, end_at, start_date, end_date_exclusive, version')
    .eq('organization_id', input.orgId)
    .eq('status', 'scheduled')
    .or(
      `and(start_at.lt.${toInstant.instant.toISOString()},end_at.gt.${fromInstant.instant.toISOString()}),and(start_date.lte.${input.to},end_date_exclusive.gt.${input.from})`
    )
    .order('start_at', { ascending: true, nullsFirst: false })
    .limit(2001);
  const { data: windowOccurrences, error } = await query;
  if (error || (windowOccurrences?.length ?? 0) > 2000) return null;
  if (!windowOccurrences?.length) return [];

  let occurrences = windowOccurrences;
  if (!input.isManager) {
    const { data: record, error: recordError } = await admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', input.orgId)
      .eq('user_id', input.userId)
      .maybeSingle();
    if (recordError) return null;
    if (!record) return [];
    const occurrenceIds = windowOccurrences.map((occurrence) => occurrence.id);
    const ownAssignments = await loadCalendarAssignments({
      admin,
      orgId: input.orgId,
      occurrenceIds,
      employeeRecordId: record.id,
    });
    if (!ownAssignments) return null;
    const ownOccurrenceIds = new Set(
      ownAssignments.map((assignment) => assignment.occurrence_id)
    );
    occurrences = windowOccurrences.filter((occurrence) =>
      ownOccurrenceIds.has(occurrence.id)
    );
    if (!occurrences.length) return [];
  }

  const occurrenceIds = occurrences.map((occurrence) => occurrence.id);
  const jobIds = [...new Set(occurrences.flatMap((occurrence) => occurrence.job_id ? [occurrence.job_id] : []))];
  const [assignments, jobResult] = await Promise.all([
    loadCalendarAssignments({
      admin,
      orgId: input.orgId,
      occurrenceIds,
    }),
    jobIds.length
      ? admin
          .from('jobs')
          .select('id, title, description, job_number, status, priority, location, client_id, project_id')
          .eq('organization_id', input.orgId)
          .in('id', jobIds)
      : { data: [], error: null },
  ]);
  if (!assignments || jobResult.error) return null;
  const employeeRecordIds = [...new Set(assignments.map((assignment) => assignment.employee_record_id))];
  const employeeResult = employeeRecordIds.length
    ? await admin
        .from('employee_records')
        .select('id, user_id')
        .eq('organization_id', input.orgId)
        .in('id', employeeRecordIds)
    : { data: [], error: null };
  if (employeeResult.error) return null;
  const userIdByRecord = new Map((employeeResult.data ?? []).map((record) => [record.id, record.user_id]));
  const assignmentsByOccurrence = new Map<string, string[]>();
  for (const assignment of assignments) {
    const list = assignmentsByOccurrence.get(assignment.occurrence_id) ?? [];
    list.push(assignment.employee_record_id);
    assignmentsByOccurrence.set(assignment.occurrence_id, list);
  }
  const jobs = new Map((jobResult.data ?? []).map((job) => [job.id, job]));
  const clientIds = [...new Set((jobResult.data ?? []).flatMap((job) => job.client_id ? [job.client_id] : []))];
  const projectIds = [...new Set((jobResult.data ?? []).flatMap((job) => job.project_id ? [job.project_id] : []))];
  const [clientResult, projectResult] = await Promise.all([
    clientIds.length
      ? admin
          .from('clients')
          .select('id, name, address')
          .eq('organization_id', input.orgId)
          .in('id', clientIds)
      : { data: [], error: null },
    projectIds.length
      ? admin
          .from('projects')
          .select('id, name, project_number')
          .eq('organization_id', input.orgId)
          .in('id', projectIds)
      : { data: [], error: null },
  ]);
  if (clientResult.error || projectResult.error) return null;
  const clients = new Map((clientResult.data ?? []).map((client) => [client.id, client]));
  const projects = new Map((projectResult.data ?? []).map((project) => [project.id, project]));

  return occurrences.flatMap((occurrence) => {
    const job = occurrence.job_id ? jobs.get(occurrence.job_id) : null;
    if (job?.status === 'geparkt') return [];
    const client = job?.client_id ? clients.get(job.client_id) : null;
    const project = job?.project_id ? projects.get(job.project_id) : null;
    const records = assignmentsByOccurrence.get(occurrence.id) ?? [];
    const startLocal = occurrence.start_at
      ? formatBerlinLocalDateTime(occurrence.start_at)
      : null;
    return [{
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
        job?.title.trim() || job?.description?.trim() || occurrence.title || '—',
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
                60_000
            )
          : null,
      assignedEmployeeRecordIds: records,
      assignedUserIds: records.flatMap((recordId) => {
        const userId = userIdByRecord.get(recordId);
        return userId ? [userId] : [];
      }),
      jobNumber: job?.job_number ?? null,
      jobStatus: job?.status ?? null,
      priority: job?.priority ?? null,
      clientName: client?.name ?? null,
      clientAddress: client?.address ?? null,
      projectName: project?.name ?? null,
      projectNumber: project?.project_number ?? null,
    }];
  });
}
