import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getBusinessTodayIso, type EmploymentType } from '@/lib/personnel/types';
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

export type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export function toCapabilityDefinition(
  row: {
    id: string;
    organization_id: string;
    kind: string;
    name: string;
    description: string | null;
    default_expiry_warning_days: number;
    retired_at: string | null;
  }
): CapabilityDefinition {
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

export function toEmployeeCapability(
  row: {
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
  }
): EmployeeCapabilityRecord {
  return {
    id: row.id,
    employeeRecordId: row.employee_record_id,
    capabilityId: row.capability_id,
    capabilityKind: row.capability_kind as EmployeeCapabilityRecord['capabilityKind'],
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    issuer: row.issuer,
    renewalDueDate: row.renewal_due_date,
    confirmationStatus:
      row.confirmation_status as EmployeeCapabilityRecord['confirmationStatus'],
    evidenceState: row.evidence_state as EmployeeCapabilityRecord['evidenceState'],
    operationalNote: row.operational_note,
    supersedesId: row.supersedes_id,
    supersededAt: row.superseded_at,
  };
}

function displayNameForEmployee(row: {
  first_name: string | null;
  last_name: string | null;
  user_id: string | null;
}, profileName: string | null): string {
  const recordName = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return profileName || recordName || 'Unbenannt';
}

export async function loadAssignmentEvaluation(input: {
  admin: AdminClient;
  orgId: string;
  jobId?: string | null;
  selectedUserIds?: string[];
  selectedEmployeeRecordIds?: string[];
  assessedForDate?: string | null;
}): Promise<
  | { success: true; evaluation: AssignmentEvaluation }
  | { success: false; error: string }
> {
  const selectedUserIds = [...new Set(input.selectedUserIds ?? [])].sort();
  const selectedEmployeeRecordIds = [
    ...new Set(input.selectedEmployeeRecordIds ?? []),
  ].sort();
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
    if (error || !job) return { success: false, error: 'job_not_found' };
    assessedForDate = assessedForDate || job.planned_date;
  }
  assessedForDate = assessedForDate || getBusinessTodayIso();

  const [
    requirementsResult,
    settingsResult,
    selectedRecordsResult,
    selectedUsersResult,
  ] = await Promise.all([
    input.jobId
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
    selectedEmployeeRecordIds.length > 0
      ? input.admin
          .from('employee_records')
          .select('id, user_id, first_name, last_name')
          .eq('organization_id', input.orgId)
          .in('id', selectedEmployeeRecordIds)
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
    selectedUserIds.length > 0
      ? input.admin
          .from('employee_records')
          .select('id, user_id, first_name, last_name')
          .eq('organization_id', input.orgId)
          .in('user_id', selectedUserIds)
          .limit(200)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (
    requirementsResult.error ||
    settingsResult.error ||
    selectedRecordsResult.error ||
    selectedUsersResult.error
  ) {
    console.error(
      'Failed to load assignment qualification context:',
      requirementsResult.error ??
        settingsResult.error ??
        selectedRecordsResult.error ??
        selectedUsersResult.error
    );
    return { success: false, error: 'load_failed' };
  }

  const employeeRows = [
    ...new Map(
      [
        ...(selectedRecordsResult.data ?? []),
        ...(selectedUsersResult.data ?? []),
      ].map((row) => [row.id, row])
    ).values(),
  ];
  const returnedRecordIds = new Set(employeeRows.map((row) => row.id));
  const returnedUserIds = new Set(employeeRows.map((row) => row.user_id));
  if (
    selectedEmployeeRecordIds.some(
      (recordId) => !returnedRecordIds.has(recordId)
    ) ||
    selectedUserIds.some((userId) => !returnedUserIds.has(userId))
  ) {
    return { success: false, error: 'member_not_found' };
  }

  const requirementRows = requirementsResult.data ?? [];
  if (requirementRows.length > 100) {
    return { success: false, error: 'load_failed' };
  }
  const capabilityIds = [
    ...new Set(requirementRows.map((row) => row.capability_id)),
  ];
  const employeeRecordIds = employeeRows.map((row) => row.id);

  const [definitionsResult, capabilityRecordsResult, conditionsResult, profilesResult] =
    await Promise.all([
      capabilityIds.length > 0
        ? input.admin
            .from('organization_capabilities')
            .select(
              'id, organization_id, kind, name, description, default_expiry_warning_days, retired_at'
            )
            .eq('organization_id', input.orgId)
            .in('id', capabilityIds)
            .is('retired_at', null)
            .order('id', { ascending: true })
            .limit(101)
        : Promise.resolve({ data: [], error: null }),
      employeeRecordIds.length > 0 && capabilityIds.length > 0
        ? input.admin
            .from('employee_capabilities')
            .select(
              'id, employee_record_id, capability_id, capability_kind, valid_from, valid_until, issuer, renewal_due_date, confirmation_status, evidence_state, operational_note, supersedes_id, superseded_at'
            )
            .eq('organization_id', input.orgId)
            .in('employee_record_id', employeeRecordIds)
            .in('capability_id', capabilityIds)
            .order('valid_from', { ascending: false })
            .limit(501)
        : Promise.resolve({ data: [], error: null }),
      employeeRecordIds.length > 0
        ? input.admin
            .from('employment_conditions')
            .select('employee_record_id, employment_type, valid_from')
            .eq('organization_id', input.orgId)
            .in('employee_record_id', employeeRecordIds)
            .lte('valid_from', assessedForDate)
            .order('valid_from', { ascending: false })
            .limit(501)
        : Promise.resolve({ data: [], error: null }),
      employeeRows.some((row) => row.user_id !== null)
        ? input.admin
            .from('profiles')
            .select('id, first_name, last_name')
            .in(
              'id',
              employeeRows.flatMap((row) => (row.user_id ? [row.user_id] : []))
            )
            .order('id', { ascending: true })
            .limit(200)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (
    definitionsResult.error ||
    capabilityRecordsResult.error ||
    conditionsResult.error ||
    profilesResult.error
  ) {
    console.error(
      'Failed to resolve assignment qualifications:',
      definitionsResult.error ??
        capabilityRecordsResult.error ??
        conditionsResult.error ??
        profilesResult.error
    );
    return { success: false, error: 'load_failed' };
  }
  if (
    (definitionsResult.data?.length ?? 0) > 100 ||
    (capabilityRecordsResult.data?.length ?? 0) > 500 ||
    (conditionsResult.data?.length ?? 0) > 500
  ) {
    return { success: false, error: 'load_failed' };
  }

  const definitions = new Map(
    (definitionsResult.data ?? []).map((row) => [
      row.id,
      toCapabilityDefinition(row),
    ])
  );
  const requirements: JobCapabilityRequirement[] = requirementRows.flatMap(
    (row) => {
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
    }
  );

  const currentConditionByRecord = new Map<string, EmploymentType>();
  for (const row of conditionsResult.data ?? []) {
    if (!currentConditionByRecord.has(row.employee_record_id)) {
      currentConditionByRecord.set(
        row.employee_record_id,
        row.employment_type as EmploymentType
      );
    }
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || null,
    ])
  );
  const capabilityRecords = (capabilityRecordsResult.data ?? []).map(
    toEmployeeCapability
  );
  const recordsByEmployee = new Map<string, EmployeeCapabilityRecord[]>();
  for (const record of capabilityRecords) {
    const existing = recordsByEmployee.get(record.employeeRecordId) ?? [];
    existing.push(record);
    recordsByEmployee.set(record.employeeRecordId, existing);
  }

  const candidates: AssignmentCandidate[] = employeeRows.map((row) => ({
    userId: row.user_id,
    employeeRecordId: row.id,
    displayName: displayNameForEmployee(
      row,
      row.user_id ? profileNames.get(row.user_id) ?? null : null
    ),
    employmentType: currentConditionByRecord.get(row.id) ?? null,
    capabilityRecords: recordsByEmployee.get(row.id) ?? [],
  }));

  return {
    success: true,
    evaluation: resolveAssignmentEvaluation({
      jobId: input.jobId ?? null,
      assessedForDate,
      candidates,
      requirements,
      apprenticeWarningEnabled:
        settingsResult.data?.apprentice_warning_enabled ?? false,
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
  const { data: rows, error } = await input.admin
    .from('employee_capabilities')
    .select(
      'id, employee_record_id, capability_id, valid_until, superseded_at'
    )
    .eq('organization_id', input.orgId)
    .eq('capability_kind', 'certification')
    .is('superseded_at', null)
    .not('valid_until', 'is', null)
    .order('valid_until', { ascending: true })
    .order('id', { ascending: true })
    .limit(501);
  if (error) {
    console.error('Failed to load certification expiry rows:', error);
    return { notices: [], failed: true };
  }
  if ((rows?.length ?? 0) > 500) {
    console.error('Certification expiry notification limit exceeded.');
    return { notices: [], failed: true };
  }
  if (!rows || rows.length === 0) {
    return { notices: [], failed: false };
  }

  const capabilityIds = [...new Set(rows.map((row) => row.capability_id))];
  const employeeRecordIds = [
    ...new Set(rows.map((row) => row.employee_record_id)),
  ];
  const [definitionsResult, employeesResult] = await Promise.all([
    input.admin
      .from('organization_capabilities')
      .select('id, name, default_expiry_warning_days')
      .eq('organization_id', input.orgId)
      .in('id', capabilityIds)
      .order('id', { ascending: true })
      .limit(500),
    input.admin
      .from('employee_records')
      .select('id, first_name, last_name, user_id')
      .eq('organization_id', input.orgId)
      .in('id', employeeRecordIds)
      .order('id', { ascending: true })
      .limit(500),
  ]);
  if (definitionsResult.error || employeesResult.error) {
    console.error(
      'Failed to load certification attention context:',
      definitionsResult.error ?? employeesResult.error
    );
    return { notices: [], failed: true };
  }
  const definitions = new Map(
    (definitionsResult.data ?? []).map((row) => [row.id, row])
  );
  const profileUserIds = [
    ...new Set(
      (employeesResult.data ?? [])
        .map((row) => row.user_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const profilesResult =
    profileUserIds.length > 0
      ? await input.admin
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', profileUserIds)
          .order('id', { ascending: true })
          .limit(500)
      : { data: [], error: null };
  if (profilesResult.error) {
    console.error(
      'Failed to load certification attention profile names:',
      profilesResult.error
    );
    return { notices: [], failed: true };
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ])
  );
  const employees = new Map(
    (employeesResult.data ?? []).map((row) => [
      row.id,
      (row.user_id ? profileNames.get(row.user_id) : null) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        'Mitarbeiter',
    ])
  );

  const notices = rows.flatMap((row) => {
    if (!row.valid_until) return [];
    const definition = definitions.get(row.capability_id);
    if (!definition) return [];
    const phase = resolveCertificationExpiryPhase(
      row.valid_until,
      today,
      definition.default_expiry_warning_days
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
            transition.getUTCDate() +
              (phase === 'expired'
                ? 1
                : -definition.default_expiry_warning_days)
          );
          return transition.toISOString();
        })(),
      },
    ];
  });
  return { notices, failed: false };
}
