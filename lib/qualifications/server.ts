import { logReadErrors } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { getBusinessTodayIso, type EmploymentType } from '@/lib/personnel/types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  resolveAssignmentEvaluation,
  resolveCertificationExpiryPhase,
  getCertificationAttentionVersion,
} from './resolution';
import type {
  AssignmentCandidate,
  AssignmentEvaluation,
  CapabilityDefinition,
  EmployeeCapabilityRecord,
  JobCapabilityRequirement,
} from './types';
import { logError } from '@/lib/logging';
import type { ActionFailure } from '@/lib/action-result';

export function toCapabilityDefinition(row: {
  id: string;
  organization_id: string;
  kind: string;
  name: string;
  description: string | null;
  default_expiry_warning_days: number;
  retired_at: string | null;
}): CapabilityDefinition {
  return {
    id: row.id,
    organizationId: row.organization_id,
    kind: row.kind as CapabilityDefinition['kind'],
    name: row.name,
    description: row.description,
    defaultExpiryWarningDays: row.default_expiry_warning_days,
    retiredAt: row.retired_at,
  };
}

export function toEmployeeCapability(row: {
  id: string;
  employee_record_id: string;
  capability_id: string;
  capability_kind: string;
  valid_from: string;
  valid_until: string | null;
  issuer: string | null;
  renewal_due_date: string | null;
  confirmation_status: string;
  evidence_state: string;
  operational_note: string | null;
  supersedes_id: string | null;
  superseded_at: string | null;
}): EmployeeCapabilityRecord {
  return {
    id: row.id,
    employeeRecordId: row.employee_record_id,
    capabilityId: row.capability_id,
    capabilityKind: row.capability_kind as EmployeeCapabilityRecord['capabilityKind'],
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    issuer: row.issuer,
    renewalDueDate: row.renewal_due_date,
    confirmationStatus: row.confirmation_status as EmployeeCapabilityRecord['confirmationStatus'],
    evidenceState: row.evidence_state as EmployeeCapabilityRecord['evidenceState'],
    operationalNote: row.operational_note,
    supersedesId: row.supersedes_id,
    supersededAt: row.superseded_at,
  };
}

function displayNameForEmployee(
  row: {
    first_name: string | null;
    last_name: string | null;
    user_id: string | null;
  },
  profileName: string | null,
): string {
  const recordName = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return profileName || recordName || 'Unbenannt';
}

type AssignmentEmployeeRow = Pick<
  Database['public']['Tables']['employee_records']['Row'],
  'id' | 'user_id' | 'first_name' | 'last_name'
>;

/** The capability definitions, capability records, employment conditions, and profiles of one evaluation; null after logging a failed read. */
async function readAssignmentQualificationRows(
  input: { admin: AdminClient; orgId: string },
  capabilityIds: string[],
  employeeRows: AssignmentEmployeeRow[],
  assessedDate: string,
) {
  const employeeRecordIds = employeeRows.map((row) => row.id);
  // Id batches with complete pages per batch. The rows are sorted newest
  // first again below, because batches arrive in id order.
  const [definitionsResult, capabilityRecordsResult, conditionsResult, profilesResult] = await Promise.all([
    readInBatches(capabilityIds, (batch) =>
      input.admin
        .from('organization_capabilities')
        .select('id, organization_id, kind, name, description, default_expiry_warning_days, retired_at')
        .eq('organization_id', input.orgId)
        .in('id', [...batch])
        .is('retired_at', null),
    ),
    // Two id lists in one query string reach the gateway limit together, so
    // the employees are batched and the required capabilities filtered below.
    capabilityIds.length > 0
      ? readInBatches(employeeRecordIds, (batch) =>
          readCompleteRows(
            (from, to) =>
              input.admin
                .from('employee_capabilities')
                .select(
                  'id, employee_record_id, capability_id, capability_kind, valid_from, valid_until, issuer, renewal_due_date, confirmation_status, evidence_state, operational_note, supersedes_id, superseded_at',
                )
                .eq('organization_id', input.orgId)
                .in('employee_record_id', [...batch])
                .order('id')
                .range(from, to),
            LIST_ROW_CAP,
          ),
        )
      : Promise.resolve({ data: [], error: null }),
    readInBatches(employeeRecordIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          input.admin
            .from('employment_conditions')
            .select('employee_record_id, employment_type, valid_from')
            .eq('organization_id', input.orgId)
            .in('employee_record_id', [...batch])
            .lte('valid_from', assessedDate)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(
      employeeRows.flatMap((row) => (row.user_id ? [row.user_id] : [])),
      (batch) =>
        input.admin
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', [...batch]),
    ),
  ]);

  if (
    definitionsResult.error ||
    capabilityRecordsResult.error ||
    conditionsResult.error ||
    profilesResult.error
  ) {
    logError(
      'Failed to resolve assignment qualifications:',
      definitionsResult.error ??
        capabilityRecordsResult.error ??
        conditionsResult.error ??
        profilesResult.error,
    );
    return null;
  }
  return {
    definitionRows: definitionsResult.data,
    capabilityRecordRows: capabilityRecordsResult.data,
    conditionRows: conditionsResult.data,
    profileRows: profilesResult.data,
  };
}

function toJobCapabilityRequirements(
  requirementRows: Array<{ id: string; capability_id: string; require_confirmation: boolean }>,
  definitionRows: Array<Parameters<typeof toCapabilityDefinition>[0]>,
): JobCapabilityRequirement[] {
  const definitions = new Map(definitionRows.map((row) => [row.id, toCapabilityDefinition(row)]));
  return requirementRows.flatMap((row) => {
    const definition = definitions.get(row.capability_id);
    if (!definition) return [];
    return [
      {
        id: row.id,
        capabilityId: definition.id,
        capabilityName: definition.name,
        capabilityKind: definition.kind,
        requireConfirmation: row.require_confirmation,
      },
    ];
  });
}

function toAssignmentCandidates(
  employeeRows: AssignmentEmployeeRow[],
  capabilityIds: string[],
  capabilityRecordRows: Array<Parameters<typeof toEmployeeCapability>[0]>,
  conditionRows: Array<{ employee_record_id: string; employment_type: string; valid_from: string }>,
  profileRows: Array<{ id: string; first_name: string | null; last_name: string | null }>,
): AssignmentCandidate[] {
  const newestFirst = (left: { valid_from: string }, right: { valid_from: string }): number =>
    right.valid_from.localeCompare(left.valid_from);
  const requiredCapabilityIds = new Set(capabilityIds);
  const currentConditionByRecord = new Map<string, EmploymentType>();
  for (const row of conditionRows.sort(newestFirst)) {
    if (!currentConditionByRecord.has(row.employee_record_id)) {
      currentConditionByRecord.set(row.employee_record_id, row.employment_type as EmploymentType);
    }
  }
  const profileNames = new Map(
    profileRows.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
    ]),
  );
  const capabilityRecords = capabilityRecordRows
    .filter((row) => requiredCapabilityIds.has(row.capability_id))
    .sort(newestFirst)
    .map(toEmployeeCapability);
  const recordsByEmployee = new Map<string, EmployeeCapabilityRecord[]>();
  for (const record of capabilityRecords) {
    const existing = recordsByEmployee.get(record.employeeRecordId) ?? [];
    existing.push(record);
    recordsByEmployee.set(record.employeeRecordId, existing);
  }

  return employeeRows.map((row) => ({
    userId: row.user_id,
    employeeRecordId: row.id,
    displayName: displayNameForEmployee(row, row.user_id ? (profileNames.get(row.user_id) ?? null) : null),
    employmentType: currentConditionByRecord.get(row.id) ?? null,
    capabilityRecords: recordsByEmployee.get(row.id) ?? [],
  }));
}

export async function loadAssignmentEvaluation(input: {
  admin: AdminClient;
  orgId: string;
  jobId?: string | null | undefined;
  selectedUserIds?: string[];
  selectedEmployeeRecordIds?: string[];
  assessedForDate?: string | null | undefined;
  requirementRows?:
    | Array<{
        id: string;
        capability_id: string;
        require_confirmation: boolean;
      }>
    | undefined;
}): Promise<{ success: true; evaluation: AssignmentEvaluation } | ActionFailure> {
  const selectedUserIds = [...new Set(input.selectedUserIds ?? [])].sort();
  const selectedEmployeeRecordIds = [...new Set(input.selectedEmployeeRecordIds ?? [])].sort();
  if (selectedUserIds.length + selectedEmployeeRecordIds.length > 200) {
    return { success: false, error: 'invalid_input' };
  }
  let assessedForDate = input.assessedForDate || null;

  if (input.jobId) {
    const { data: job, error } = await input.admin
      .from('jobs')
      .select('id, planned_date')
      .eq('id', input.jobId)
      .eq('organization_id', input.orgId)
      .single();
    if (error || !job) {
      logReadErrors('loadAssignmentEvaluation: read failed', error);
      return { success: false, error: 'job_not_found' };
    }
    assessedForDate = assessedForDate || job.planned_date;
  }
  assessedForDate = assessedForDate || getBusinessTodayIso();

  const [requirementsResult, settingsResult, selectedRecordsResult, selectedUsersResult] = await Promise.all([
    input.requirementRows
      ? Promise.resolve({ data: input.requirementRows, error: null })
      : input.jobId
        ? input.admin
            .from('job_capability_requirements')
            .select('id, capability_id, require_confirmation')
            .eq('organization_id', input.orgId)
            .eq('job_id', input.jobId)
            .order('created_at', { ascending: true })
            .limit(101)
        : Promise.resolve({ data: [], error: null }),
    input.admin
      .from('organization_qualification_settings')
      .select('apprentice_warning_enabled')
      .eq('organization_id', input.orgId)
      .maybeSingle(),
    readInBatches(selectedEmployeeRecordIds, (batch) =>
      input.admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', input.orgId)
        .in('id', [...batch]),
    ),
    readInBatches(selectedUserIds, (batch) =>
      input.admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', input.orgId)
        .in('user_id', [...batch]),
    ),
  ]);

  if (
    requirementsResult.error ||
    settingsResult.error ||
    selectedRecordsResult.error ||
    selectedUsersResult.error
  ) {
    logError(
      'Failed to load assignment qualification context:',
      requirementsResult.error ??
        settingsResult.error ??
        selectedRecordsResult.error ??
        selectedUsersResult.error,
    );
    return { success: false, error: 'load_failed' };
  }

  const employeeRows = [
    ...new Map(
      [...selectedRecordsResult.data, ...selectedUsersResult.data].map((row) => [row.id, row]),
    ).values(),
  ];
  const returnedRecordIds = new Set(employeeRows.map((row) => row.id));
  const returnedUserIds = new Set(employeeRows.map((row) => row.user_id));
  if (
    selectedEmployeeRecordIds.some((recordId) => !returnedRecordIds.has(recordId)) ||
    selectedUserIds.some((userId) => !returnedUserIds.has(userId))
  ) {
    return { success: false, error: 'member_not_found' };
  }

  // A job holds at most 100 requirements (the write path refuses more).
  const requirementRows = requirementsResult.data ?? [];
  if (requirementRows.length > 100) {
    logError('Assignment qualification requirements exceeded their bound:', {
      code: 'requirement_overflow',
    });
    return { success: false, error: 'load_failed' };
  }
  const capabilityIds = [...new Set(requirementRows.map((row) => row.capability_id))];
  const assessedDate = assessedForDate;
  const qualificationRows = await readAssignmentQualificationRows(
    input,
    capabilityIds,
    employeeRows,
    assessedDate,
  );
  if (!qualificationRows) return { success: false, error: 'load_failed' };
  const requirements = toJobCapabilityRequirements(requirementRows, qualificationRows.definitionRows);
  const candidates = toAssignmentCandidates(
    employeeRows,
    capabilityIds,
    qualificationRows.capabilityRecordRows,
    qualificationRows.conditionRows,
    qualificationRows.profileRows,
  );

  return {
    success: true,
    evaluation: resolveAssignmentEvaluation({
      jobId: input.jobId ?? null,
      assessedForDate,
      candidates,
      requirements,
      apprenticeWarningEnabled: settingsResult.data?.apprentice_warning_enabled ?? false,
    }),
  };
}

export async function loadCertificationExpiryNotifications(input: {
  admin: AdminClient;
  orgId: string;
  today?: string;
}): Promise<{
  notices: Array<{
    sourceId: string;
    stateVersion: string;
    employeeRecordId: string;
    employeeName: string;
    capabilityName: string;
    validUntil: string;
    phase: 'approaching' | 'expired';
    occurredAt: string;
  }>;
  failed: boolean;
}> {
  const today = input.today ?? getBusinessTodayIso();
  // Every current certification with an end date: a few hundred employees
  // hold more of them than one response returns.
  const { data: rows, error } = await readCompleteRows(
    (from, to) =>
      input.admin
        .from('employee_capabilities')
        .select('id, employee_record_id, capability_id, valid_until, superseded_at')
        .eq('organization_id', input.orgId)
        .eq('capability_kind', 'certification')
        .is('superseded_at', null)
        .not('valid_until', 'is', null)
        .order('valid_until', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('Failed to load certification expiry rows:', error);
    return { notices: [], failed: true };
  }
  if (rows.length === 0) {
    return { notices: [], failed: false };
  }

  const [definitionsResult, employeesResult] = await Promise.all([
    readInBatches(
      rows.map((row) => row.capability_id),
      (batch) =>
        input.admin
          .from('organization_capabilities')
          .select('id, name, default_expiry_warning_days')
          .eq('organization_id', input.orgId)
          .in('id', [...batch]),
    ),
    readInBatches(
      rows.map((row) => row.employee_record_id),
      (batch) =>
        input.admin
          .from('employee_records')
          .select('id, first_name, last_name, user_id')
          .eq('organization_id', input.orgId)
          .in('id', [...batch]),
    ),
  ]);
  if (definitionsResult.error || employeesResult.error) {
    logError(
      'Failed to load certification attention context:',
      definitionsResult.error ?? employeesResult.error,
    );
    return { notices: [], failed: true };
  }
  const definitions = new Map(definitionsResult.data.map((row) => [row.id, row]));
  const profilesResult = await readInBatches(
    employeesResult.data.flatMap((row) => (row.user_id ? [row.user_id] : [])),
    (batch) =>
      input.admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load certification attention profile names:', profilesResult.error);
    return { notices: [], failed: true };
  }
  const profileNames = new Map(
    profilesResult.data.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  const employees = new Map(
    employeesResult.data.map((row) => [
      row.id,
      (row.user_id ? profileNames.get(row.user_id) : null) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        'Mitarbeiter',
    ]),
  );

  const notices = rows.flatMap((row) => {
    if (!row.valid_until) return [];
    const definition = definitions.get(row.capability_id);
    if (!definition) return [];
    const phase = resolveCertificationExpiryPhase(
      row.valid_until,
      today,
      definition.default_expiry_warning_days,
    );
    if (phase === 'none') return [];
    return [
      {
        sourceId: row.id,
        stateVersion: getCertificationAttentionVersion({
          validUntil: row.valid_until,
          phase,
        }),
        employeeRecordId: row.employee_record_id,
        employeeName: employees.get(row.employee_record_id) ?? 'Mitarbeiter',
        capabilityName: definition.name,
        validUntil: row.valid_until,
        phase,
        occurredAt: (() => {
          const transition = new Date(`${row.valid_until}T00:00:00Z`);
          transition.setUTCDate(
            transition.getUTCDate() + (phase === 'expired' ? 1 : -definition.default_expiry_warning_days),
          );
          return transition.toISOString();
        })(),
      },
    ];
  });
  return { notices, failed: false };
}
