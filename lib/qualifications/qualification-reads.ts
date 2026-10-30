import 'server-only';
import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';
import type { ActionFailure } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';
import type { QualificationWorkspace } from './types';
import { toCapabilityDefinition, toEmployeeCapability } from './server';

// The qualification reads behind the Server Actions: the office workspace, one
// employee's summary, the caller's own profile, a team's expansion and a job's
// qualification detail. Callers resolve organization and role first.

type Tables = Database['public']['Tables'];
type TeamRow = Tables['teams']['Row'];
type TeamMembershipRow = Tables['team_memberships']['Row'];
type CapabilityRow = Tables['organization_capabilities']['Row'];
type EmployeeCapabilityRow = Tables['employee_capabilities']['Row'];
type ReferenceRead<Row> = { data: Row[]; error: PostgrestError | null };

function readWorkspaceRows(admin: AdminClient, orgId: string) {
  return Promise.all([
    // Complete paged reads: a company with 600 employees holds more rows
    // than one response returns, and an overflow fails like a query error.
    readCompleteRows(
      (from, to) =>
        admin
          .from('teams')
          .select('*')
          .eq('organization_id', orgId)
          .order('dissolved_at', { ascending: true, nullsFirst: true })
          .order('name', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('team_memberships')
          .select('*')
          .eq('organization_id', orgId)
          .order('valid_from', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_capabilities')
          .select('*')
          .eq('organization_id', orgId)
          .order('retired_at', { ascending: true, nullsFirst: true })
          .order('kind', { ascending: true })
          .order('name', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_capabilities')
          .select('*')
          .eq('organization_id', orgId)
          .order('valid_from', { ascending: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_records')
          .select('id, user_id, first_name, last_name')
          .eq('organization_id', orgId)
          .order('last_name', { ascending: true, nullsFirst: false })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    admin
      .from('organization_qualification_settings')
      .select('apprentice_warning_enabled')
      .eq('organization_id', orgId)
      .maybeSingle(),
  ]);
}

type WorkspaceRows = Awaited<ReturnType<typeof readWorkspaceRows>>;

// Each linked user's profile name; null when the read fails.
async function loadWorkspaceProfileNames(
  admin: AdminClient,
  userIds: string[],
): Promise<Map<string, string> | null> {
  const { data: profiles, error: profilesError } = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (profilesError) {
    logError('Failed to load qualification profile names:', profilesError);
    return null;
  }
  return new Map(
    profiles.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
}

function toQualificationWorkspace(
  [
    teamsResult,
    membershipsResult,
    definitionsResult,
    employeeCapabilitiesResult,
    employeesResult,
    settingsResult,
  ]: WorkspaceRows,
  profileNames: Map<string, string>,
  isAdmin: boolean,
): QualificationWorkspace {
  return {
    teams: teamsResult.data.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      description: row.description,
      dissolvedAt: row.dissolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    teamMemberships: membershipsResult.data.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      teamId: row.team_id,
      employeeRecordId: row.employee_record_id,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    capabilities: definitionsResult.data.map(toCapabilityDefinition),
    employeeCapabilities: employeeCapabilitiesResult.data.map(toEmployeeCapability),
    employees: employeesResult.data.map((row) => ({
      employeeRecordId: row.id,
      userId: row.user_id,
      displayName:
        (row.user_id ? profileNames.get(row.user_id) : null) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
    })),
    apprenticeWarningEnabled: settingsResult.data?.apprentice_warning_enabled ?? false,
    isAdmin,
  };
}

/** The office workspace for an organization; null when a read fails. */
export async function loadQualificationWorkspace(
  admin: AdminClient,
  orgId: string,
  isAdmin: boolean,
): Promise<QualificationWorkspace | null> {
  const rows = await readWorkspaceRows(admin, orgId);
  const [
    teamsResult,
    membershipsResult,
    definitionsResult,
    employeeCapabilitiesResult,
    employeesResult,
    settingsResult,
  ] = rows;
  const firstError =
    teamsResult.error ??
    membershipsResult.error ??
    definitionsResult.error ??
    employeeCapabilitiesResult.error ??
    employeesResult.error ??
    settingsResult.error;
  if (firstError) {
    logError('Failed to load qualification workspace:', firstError);
    return null;
  }
  const userIds = employeesResult.data.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const profileNames = await loadWorkspaceProfileNames(admin, userIds);
  if (!profileNames) return null;
  return toQualificationWorkspace(rows, profileNames, isAdmin);
}

// An employee's team memberships and current capability records on the day,
// each read one row past the 500 a profile shows.
export function readCurrentQualificationRows(
  admin: AdminClient,
  orgId: string,
  employeeRecordId: string,
  today: string,
): Promise<
  [
    PostgrestSingleResponse<Pick<TeamMembershipRow, 'team_id'>[]>,
    PostgrestSingleResponse<EmployeeCapabilityRow[]>,
  ]
> {
  return Promise.all([
    admin
      .from('team_memberships')
      .select('team_id')
      .eq('organization_id', orgId)
      .eq('employee_record_id', employeeRecordId)
      .lte('valid_from', today)
      .or(`valid_until.gte.${today},valid_until.is.null`)
      .limit(501),
    admin
      .from('employee_capabilities')
      .select('*')
      .eq('organization_id', orgId)
      .eq('employee_record_id', employeeRecordId)
      .is('superseded_at', null)
      .order('valid_from', { ascending: false })
      .limit(501),
  ]);
}

// The active teams and the capability definitions a profile names.
export function readQualificationReferences(
  admin: AdminClient,
  orgId: string,
  teamIds: string[],
  capabilityIds: string[],
): Promise<[ReferenceRead<Pick<TeamRow, 'id' | 'name'>>, ReferenceRead<CapabilityRow>]> {
  return Promise.all([
    readInBatches(teamIds, (batch) =>
      admin
        .from('teams')
        .select('id, name')
        .eq('organization_id', orgId)
        .is('dissolved_at', null)
        .in('id', [...batch]),
    ),
    readInBatches(capabilityIds, (batch) =>
      admin
        .from('organization_capabilities')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
  ]);
}

// The employee record behind an id that names the member's user or the record itself.
export async function resolveSummaryEmployeeRecord(
  admin: AdminClient,
  orgId: string,
  employeeRecordIdOrUserId: string,
): Promise<{ success: true; record: { id: string } | null } | ActionFailure> {
  const byUserResult = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', orgId)
    .eq('user_id', employeeRecordIdOrUserId)
    .maybeSingle();
  if (byUserResult.error) {
    logError('Failed to resolve qualification employee:', byUserResult.error);
    return { success: false, error: 'load_failed' };
  }
  if (byUserResult.data) return { success: true, record: byUserResult.data };

  const byRecordResult = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', employeeRecordIdOrUserId)
    .maybeSingle();
  if (byRecordResult.error) {
    logError('Failed to resolve qualification employee record:', byRecordResult.error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, record: byRecordResult.data };
}

/** The members a team expands to on a date, and the names it skips. */
type TeamExpansion = { userIds: string[]; skippedNames: string[] };

// The team's members on the date: active members become user ids, the rest
// skipped names. Null after a logged read failure.
export async function expandTeamMembers(
  admin: AdminClient,
  orgId: string,
  teamId: string,
  date: string,
): Promise<TeamExpansion | null> {
  const teamExpansionFailed = (read: string, readError: unknown): null => {
    logError(`Failed to expand team for assignment (${read}):`, readError);
    return null;
  };
  // A team may hold every employee of the company: complete pages, then id batches.
  const { data: memberships, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('team_memberships')
        .select('employee_record_id')
        .eq('organization_id', orgId)
        .eq('team_id', teamId)
        .lte('valid_from', date)
        .or(`valid_until.gte.${date},valid_until.is.null`)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) return teamExpansionFailed('memberships', error);
  const recordIds = memberships.map((row) => row.employee_record_id);
  const recordsResult = await readInBatches(recordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (recordsResult.error) return teamExpansionFailed('employee records', recordsResult.error);
  const records = recordsResult.data.sort((left, right) => left.id.localeCompare(right.id));
  const linkedUserIds = records.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const { data: memberRows, error: membersError } = await readInBatches(linkedUserIds, (batch) =>
    admin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', orgId)
      .in('user_id', [...batch]),
  );
  if (membersError) return teamExpansionFailed('organization members', membersError);
  const activeMemberIds = new Set(memberRows.map((row) => row.user_id));
  return {
    userIds: records
      .map((row) => row.user_id)
      .filter((id): id is string => Boolean(id && activeMemberIds.has(id))),
    skippedNames: records
      .filter((row) => !row.user_id || !activeMemberIds.has(row.user_id))
      .map((row) => [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unbenannt'),
  };
}

function readJobQualificationRows(admin: AdminClient, orgId: string, jobId: string) {
  return Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_capabilities')
          .select('*')
          .eq('organization_id', orgId)
          .is('retired_at', null)
          .order('name', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    admin
      .from('job_capability_requirements')
      .select('id, capability_id, require_confirmation')
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(100),
    admin
      .from('job_assignments')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .limit(201),
    admin
      .from('job_qualification_assessments')
      .select('created_at, override_reason, coverage_fingerprint')
      .eq('organization_id', orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
}

/** The rows behind a job's qualification detail. */
type JobQualificationRows = {
  definitions: CapabilityRow[];
  requirements: Pick<
    Tables['job_capability_requirements']['Row'],
    'id' | 'capability_id' | 'require_confirmation'
  >[];
  assignedUserIds: string[];
  latest: Pick<
    Tables['job_qualification_assessments']['Row'],
    'created_at' | 'override_reason' | 'coverage_fingerprint'
  > | null;
};

// The job's active definitions, requirements, assigned users and latest
// assessment; null after a logged read failure.
export async function loadJobQualificationRows(
  admin: AdminClient,
  orgId: string,
  jobId: string,
): Promise<JobQualificationRows | null> {
  const [definitionsResult, requirementsResult, assignmentsResult, latestResult] =
    await readJobQualificationRows(admin, orgId, jobId);
  const error =
    definitionsResult.error ?? requirementsResult.error ?? assignmentsResult.error ?? latestResult.error;
  if (error) {
    logError('Failed to load job qualification detail:', error);
    return null;
  }
  return {
    definitions: definitionsResult.data,
    requirements: requirementsResult.data ?? [],
    assignedUserIds: (assignmentsResult.data ?? []).map((row) => row.user_id),
    latest: latestResult.data,
  };
}
