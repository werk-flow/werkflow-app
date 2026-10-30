import 'server-only';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { toEmploymentType, type EmploymentType } from '@/lib/personnel/types';
import { toCapabilityDefinition, toEmployeeCapability } from '@/lib/qualifications/server';
import { resolveAssignmentEvaluation } from '@/lib/qualifications/resolution';
import type {
  AssignmentCandidate,
  AssignmentEvaluation,
  EmployeeCapabilityRecord,
  JobCapabilityRequirement,
} from '@/lib/qualifications/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';

type QualificationAssessmentRequest = {
  localDate: string;
  employeeRecordIds: string[];
};

type AssessedEmployee = Pick<Tables<'employee_records'>, 'id' | 'user_id' | 'first_name' | 'last_name'>;
type EmploymentConditionStart = { validFrom: string; employmentType: EmploymentType };

function qualificationReadFailed(read: string, error: { message: string; code?: string }): null {
  logReadFailure(`loadPlanningQualificationEvaluations: ${read} failed`, {
    code: error.code ?? 'unknown',
    message: error.message,
  });
  return null;
}

/** The job's requirements, the apprentice setting, the assessed people and their employment conditions. */
async function loadAssignmentContext(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string | null;
  employeeRecordIds: string[];
  latestDate: string;
}) {
  const { admin, orgId, employeeRecordIds } = input;
  const [requirementsResult, settingsResult, employeesResult, conditionsResult] = await Promise.all([
    input.jobId
      ? admin
          .from('job_capability_requirements')
          .select('id, capability_id, require_confirmation')
          .eq('organization_id', orgId)
          .eq('job_id', input.jobId)
          .order('created_at')
          .limit(101)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('organization_qualification_settings')
      .select('apprentice_warning_enabled')
      .eq('organization_id', orgId)
      .maybeSingle(),
    readInBatches(employeeRecordIds, (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    // The condition valid on each date is chosen in memory below, so the
    // pages only need a stable order.
    readInBatches(employeeRecordIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('employment_conditions')
            .select('employee_record_id, employment_type, valid_from')
            .eq('organization_id', orgId)
            .in('employee_record_id', [...batch])
            .lte('valid_from', input.latestDate)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const contextError =
    requirementsResult.error ?? settingsResult.error ?? employeesResult.error ?? conditionsResult.error;
  if (contextError) return qualificationReadFailed('assignment context', contextError);
  // A job holds at most 100 requirements (the write path refuses more).
  if ((requirementsResult.data?.length ?? 0) > 100) {
    return qualificationReadFailed('requirements', {
      code: 'requirement_overflow',
      message: 'More than 100 requirements on one job.',
    });
  }
  if (employeesResult.data.length !== employeeRecordIds.length) {
    return qualificationReadFailed('employee records', {
      code: 'employee_not_found',
      message: 'An assigned employee record is missing.',
    });
  }
  return {
    requirementRows: requirementsResult.data ?? [],
    apprenticeWarningEnabled: settingsResult.data?.apprentice_warning_enabled ?? false,
    employees: employeesResult.data,
    conditionRows: conditionsResult.data,
  };
}

/** The required capabilities' definitions, the assessed people's capability records and their profiles. */
async function loadCapabilityContext(input: {
  admin: AdminClient;
  orgId: string;
  employeeRecordIds: string[];
  capabilityIds: string[];
  userIds: string[];
}) {
  const { admin, orgId, employeeRecordIds, capabilityIds } = input;
  const [definitionsResult, recordsResult, profilesResult] = await Promise.all([
    readInBatches(capabilityIds, (batch) =>
      admin
        .from('organization_capabilities')
        .select('id, organization_id, kind, name, description, default_expiry_warning_days, retired_at')
        .eq('organization_id', orgId)
        .in('id', [...batch])
        .is('retired_at', null),
    ),
    // Two id lists in one query string reach the gateway limit together, so
    // the employees are batched and the required capabilities filtered below.
    capabilityIds.length
      ? readInBatches(employeeRecordIds, (batch) =>
          readCompleteRows(
            (from, to) =>
              admin
                .from('employee_capabilities')
                .select(
                  'id, employee_record_id, capability_id, capability_kind, valid_from, valid_until, issuer, renewal_due_date, confirmation_status, evidence_state, operational_note, supersedes_id, superseded_at',
                )
                .eq('organization_id', orgId)
                .in('employee_record_id', [...batch])
                .order('id')
                .range(from, to),
            LIST_ROW_CAP,
          ),
        )
      : Promise.resolve({ data: [], error: null }),
    readInBatches(input.userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  ]);
  const capabilityError = definitionsResult.error ?? recordsResult.error ?? profilesResult.error;
  if (capabilityError) return qualificationReadFailed('capabilities or profiles', capabilityError);
  return {
    definitionRows: definitionsResult.data,
    capabilityRows: recordsResult.data,
    profiles: profilesResult.data,
  };
}

function groupByEmployee<Value>(entries: Array<[string, Value]>): Map<string, Value[]> {
  const grouped = new Map<string, Value[]>();
  for (const [employeeRecordId, value] of entries) {
    const values = grouped.get(employeeRecordId) ?? [];
    values.push(value);
    grouped.set(employeeRecordId, values);
  }
  return grouped;
}

/** The assessed people on one date, each with the employment condition valid that day. */
function assignmentCandidatesOn(input: {
  assessment: QualificationAssessmentRequest;
  employees: Map<string, AssessedEmployee>;
  conditionsByEmployee: Map<string, EmploymentConditionStart[]>;
  capabilityRecordsByEmployee: Map<string, EmployeeCapabilityRecord[]>;
  profileNames: Map<string, string>;
}): AssignmentCandidate[] {
  const { assessment } = input;
  return assessment.employeeRecordIds.flatMap((employeeRecordId) => {
    const employee = input.employees.get(employeeRecordId);
    if (!employee) return [];
    const condition = (input.conditionsByEmployee.get(employeeRecordId) ?? [])
      .filter((entry) => entry.validFrom <= assessment.localDate)
      .sort((left, right) => right.validFrom.localeCompare(left.validFrom))[0];
    const recordName = [employee.first_name, employee.last_name].filter(Boolean).join(' ');
    return [
      {
        userId: employee.user_id,
        employeeRecordId,
        displayName:
          (employee.user_id ? input.profileNames.get(employee.user_id) : null) || recordName || 'Unbenannt',
        employmentType: condition?.employmentType ?? null,
        capabilityRecords: input.capabilityRecordsByEmployee.get(employeeRecordId) ?? [],
      },
    ];
  });
}

export async function loadPlanningQualificationEvaluations(input: {
  admin: AdminClient;
  orgId: string;
  jobId: string | null;
  assessments: QualificationAssessmentRequest[];
}): Promise<AssignmentEvaluation[] | null> {
  const employeeRecordIds = [
    ...new Set(input.assessments.flatMap((assessment) => assessment.employeeRecordIds)),
  ];
  if (employeeRecordIds.length === 0) return [];
  const latestDate = input.assessments
    .map((assessment) => assessment.localDate)
    .sort()
    .at(-1);
  if (!latestDate) return [];

  const context = await loadAssignmentContext({ ...input, employeeRecordIds, latestDate });
  if (!context) return null;
  const capabilityIds = [...new Set(context.requirementRows.map((requirement) => requirement.capability_id))];
  const capabilities = await loadCapabilityContext({
    admin: input.admin,
    orgId: input.orgId,
    employeeRecordIds,
    capabilityIds,
    userIds: context.employees.flatMap((employee) => (employee.user_id ? [employee.user_id] : [])),
  });
  if (!capabilities) return null;
  const requiredCapabilityIds = new Set(capabilityIds);
  const definitions = new Map(
    capabilities.definitionRows.map((definition) => [definition.id, toCapabilityDefinition(definition)]),
  );
  const requirements: JobCapabilityRequirement[] = context.requirementRows.flatMap((requirement) => {
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
  const capabilityRecordsByEmployee = groupByEmployee(
    capabilities.capabilityRows
      .filter((record) => requiredCapabilityIds.has(record.capability_id))
      .map(toEmployeeCapability)
      .map((record): [string, EmployeeCapabilityRecord] => [record.employeeRecordId, record]),
  );
  const conditionsByEmployee = groupByEmployee(
    context.conditionRows.map((condition): [string, EmploymentConditionStart] => [
      condition.employee_record_id,
      { validFrom: condition.valid_from, employmentType: toEmploymentType(condition.employment_type) },
    ]),
  );
  const profileNames = new Map(
    capabilities.profiles.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  const employees = new Map(context.employees.map((employee) => [employee.id, employee]));

  return input.assessments.map((assessment) =>
    resolveAssignmentEvaluation({
      jobId: input.jobId,
      assessedForDate: assessment.localDate,
      candidates: assignmentCandidatesOn({
        assessment,
        employees,
        conditionsByEmployee,
        capabilityRecordsByEmployee,
        profileNames,
      }),
      requirements,
      apprenticeWarningEnabled: context.apprenticeWarningEnabled,
    }),
  );
}
