'use server';

import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { normalizeOptionalText } from '@/lib/validation/text';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import {
  CAPABILITY_KINDS,
  CONFIRMATION_STATUSES,
  EVIDENCE_STATES,
  type CapabilityDefinition,
  type CapabilityKind,
  type ConfirmationStatus,
  type EvidenceState,
  type QualificationWorkspace,
  type OwnQualificationProfile,
  type JobQualificationDetail,
  type PersonnelQualificationSummary,
} from './types';
import { loadAssignmentEvaluation, toCapabilityDefinition, toEmployeeCapability } from './server';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

// Boundary schemas: types, ids and bounds. The date and name rules below keep
// their own error codes for the forms.
const qualificationDate = z.string().max(10);
const qualificationNote = z.string().max(2000).nullable().optional();
const capabilityRequirementsSchema = z
  .array(z.object({ capabilityId: uuidSchema, requireConfirmation: z.boolean() }))
  .max(200);
const createTeamSchema = z.object({ name: z.string().max(200), description: qualificationNote });
const updateTeamSchema = createTeamSchema.extend({ teamId: uuidSchema });
const dissolveTeamSchema = z.object({ teamId: uuidSchema, reason: qualificationNote });
const addTeamMembershipSchema = z.object({
  teamId: uuidSchema,
  employeeRecordId: uuidSchema,
  validFrom: qualificationDate,
  validUntil: qualificationDate.nullable().optional(),
});
const endTeamMembershipSchema = z.object({ membershipId: uuidSchema, validUntil: qualificationDate });
const createCapabilitySchema = z.object({
  kind: z.enum(CAPABILITY_KINDS),
  name: z.string().max(200),
  description: qualificationNote,
  expiryWarningDays: z.number().int().min(0).max(3650).optional(),
});
const capabilityRecordFields = {
  validFrom: qualificationDate,
  validUntil: qualificationDate.nullable().optional(),
  issuer: z.string().max(300).nullable().optional(),
  renewalDueDate: qualificationDate.nullable().optional(),
  operationalNote: qualificationNote,
};
const addEmployeeCapabilitySchema = z.object({
  ...capabilityRecordFields,
  employeeRecordId: uuidSchema,
  capabilityId: uuidSchema,
  confirmationStatus: z.enum(CONFIRMATION_STATUSES).optional(),
  evidenceState: z.enum(EVIDENCE_STATES).optional(),
  supersedesId: uuidSchema.nullable().optional(),
});
const updateEmployeeCapabilitySchema = z.object({
  ...capabilityRecordFields,
  recordId: uuidSchema,
  confirmationStatus: z.enum(CONFIRMATION_STATUSES),
  evidenceState: z.enum(EVIDENCE_STATES),
});
const jobRequirementsSchema = z.object({ jobId: uuidSchema, requirements: capabilityRequirementsSchema });
const projectRequirementsSchema = z.object({
  projectId: uuidSchema,
  requirements: capabilityRequirementsSchema,
  expectedRequirements: capabilityRequirementsSchema,
});
const expandTeamSchema = z.object({
  teamId: uuidSchema,
  assessedForDate: qualificationDate.nullable().optional(),
});

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && ISO_DATE_PATTERN.test(value));
}

function isOrderedRange(validFrom: string, validUntil: string | null | undefined): boolean {
  return !validUntil || validUntil >= validFrom;
}

// The refusals of the qualification write functions (migrations
// 20261004180000_write_qualification_history_with_its_change.sql and
// 20261004190000_write_employee_capability_history_with_its_change.sql), each
// an action failure code. Each function writes the change and its history row
// together or refuses and changes nothing.
const QUALIFICATION_WRITE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_authorized',
  'duplicate_name',
  'team_not_found',
  'employee_not_found',
  'overlap',
  'record_not_found',
  'definition_not_found',
]);

// The refusal raised under the lock, or the action's own failure code for
// anything else.
function qualificationWriteFailure(
  error: { message: string } | null,
  failureCode: string,
  logLabel: string,
): ActionFailure {
  if (error && QUALIFICATION_WRITE_REFUSALS.has(error.message))
    return { success: false, error: error.message };
  logError(logLabel, error);
  return { success: false, error: failureCode };
}

export async function getQualificationWorkspace(): Promise<
  { success: true; data: QualificationWorkspace } | ActionFailure
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }
    const { orgId, role } = auth.context;
    const admin = createSupabaseAdminClient();
    const [
      teamsResult,
      membershipsResult,
      definitionsResult,
      employeeCapabilitiesResult,
      employeesResult,
      settingsResult,
    ] = await Promise.all([
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
    const firstError =
      teamsResult.error ??
      membershipsResult.error ??
      definitionsResult.error ??
      employeeCapabilitiesResult.error ??
      employeesResult.error ??
      settingsResult.error;
    if (firstError) {
      logError('Failed to load qualification workspace:', firstError);
      return { success: false, error: 'load_failed' };
    }
    const userIds = employeesResult.data.map((row) => row.user_id).filter((id): id is string => Boolean(id));
    const { data: profiles, error: profilesError } = await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    );
    if (profilesError) {
      logError('Failed to load qualification profile names:', profilesError);
      return { success: false, error: 'load_failed' };
    }
    const profileNames = new Map(
      profiles.map((profile) => [
        profile.id,
        [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      ]),
    );

    return {
      success: true,
      data: {
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
        isAdmin: role === 'admin',
      },
    };
  } catch (error) {
    logError('Unexpected error in getQualificationWorkspace:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getPersonnelQualificationSummary(
  employeeRecordIdOrUserIdInput: string,
): Promise<{ success: true; data: PersonnelQualificationSummary | null } | ActionFailure> {
  const parsedEmployeeRecordIdOrUserId = uuidSchema.safeParse(employeeRecordIdOrUserIdInput);
  if (!parsedEmployeeRecordIdOrUserId.success) return { success: false, error: 'invalid_input' };
  const employeeRecordIdOrUserId = parsedEmployeeRecordIdOrUserId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const { orgId } = auth.context;
    const admin = createSupabaseAdminClient();
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

    let employeeRecord = byUserResult.data;
    if (!employeeRecord) {
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
      employeeRecord = byRecordResult.data;
    }
    if (!employeeRecord) return { success: true, data: null };

    const today = getBusinessTodayIso();
    const [membershipsResult, capabilityRowsResult] = await Promise.all([
      admin
        .from('team_memberships')
        .select('team_id')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employeeRecord.id)
        .lte('valid_from', today)
        .or(`valid_until.gte.${today},valid_until.is.null`)
        .limit(501),
      admin
        .from('employee_capabilities')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employeeRecord.id)
        .is('superseded_at', null)
        .order('valid_from', { ascending: false })
        .limit(501),
    ]);
    if (membershipsResult.error || capabilityRowsResult.error) {
      logError(
        'Failed to load personnel qualification summary:',
        membershipsResult.error ?? capabilityRowsResult.error,
      );
      return { success: false, error: 'load_failed' };
    }
    if ((membershipsResult.data?.length ?? 0) > 500 || (capabilityRowsResult.data?.length ?? 0) > 500) {
      logError('Personnel qualification summary size limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const teamIds = [...new Set((membershipsResult.data ?? []).map((row) => row.team_id))];
    const capabilityIds = [...new Set((capabilityRowsResult.data ?? []).map((row) => row.capability_id))];
    const [teamsResult, definitionsResult] = await Promise.all([
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
    if (teamsResult.error || definitionsResult.error) {
      logError(
        'Failed to load personnel qualification references:',
        teamsResult.error ?? definitionsResult.error,
      );
      return { success: false, error: 'load_failed' };
    }

    const definitionById = new Map(
      definitionsResult.data.map((row) => [row.id, toCapabilityDefinition(row)]),
    );
    return {
      success: true,
      data: {
        teamNames: teamsResult.data
          .map((team) => team.name)
          .sort((left, right) => left.localeCompare(right, 'de-DE')),
        entries: (capabilityRowsResult.data ?? []).flatMap((row) => {
          const definition = definitionById.get(row.capability_id);
          return definition ? [{ definition, record: toEmployeeCapability(row) }] : [];
        }),
      },
    };
  } catch (error) {
    logError('Unexpected error in getPersonnelQualificationSummary:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getOwnQualificationProfile(): Promise<
  { success: true; data: OwnQualificationProfile | null } | ActionFailure
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId } = auth.context;
    const admin = createSupabaseAdminClient();
    const { data: employee, error } = await admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      logError('Failed to resolve own qualification employee record:', error);
      return { success: false, error: 'load_failed' };
    }
    if (!employee) return { success: true, data: null };

    const today = getBusinessTodayIso();
    const [membershipsResult, capabilityRowsResult, profileResult] = await Promise.all([
      admin
        .from('team_memberships')
        .select('team_id')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employee.id)
        .lte('valid_from', today)
        .or(`valid_until.gte.${today},valid_until.is.null`)
        .limit(501),
      admin
        .from('employee_capabilities')
        .select('*')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employee.id)
        .is('superseded_at', null)
        .order('valid_from', { ascending: false })
        .limit(501),
      admin.from('profiles').select('first_name, last_name').eq('id', userId).maybeSingle(),
    ]);
    if (membershipsResult.error || capabilityRowsResult.error || profileResult.error) {
      logError(
        'Failed to load own qualification profile:',
        membershipsResult.error ?? capabilityRowsResult.error ?? profileResult.error,
      );
      return { success: false, error: 'load_failed' };
    }
    if ((membershipsResult.data?.length ?? 0) > 500 || (capabilityRowsResult.data?.length ?? 0) > 500) {
      logError('Own qualification profile size limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const teamIds = (membershipsResult.data ?? []).map((row) => row.team_id);
    const capabilityRows = capabilityRowsResult.data ?? [];
    const definitionIds = [...new Set(capabilityRows.map((row) => row.capability_id))];
    const [teamsResult, definitionsResult] = await Promise.all([
      readInBatches(teamIds, (batch) =>
        admin
          .from('teams')
          .select('id, name')
          .eq('organization_id', orgId)
          .is('dissolved_at', null)
          .in('id', [...batch]),
      ),
      readInBatches(definitionIds, (batch) =>
        admin
          .from('organization_capabilities')
          .select('*')
          .eq('organization_id', orgId)
          .in('id', [...batch]),
      ),
    ]);
    if (teamsResult.error || definitionsResult.error) {
      logError('Failed to load own qualification references:', teamsResult.error ?? definitionsResult.error);
      return { success: false, error: 'load_failed' };
    }
    const definitions = new Map(definitionsResult.data.map((row) => [row.id, toCapabilityDefinition(row)]));
    const displayName =
      [profileResult.data?.first_name, profileResult.data?.last_name].filter(Boolean).join(' ') ||
      [employee.first_name, employee.last_name].filter(Boolean).join(' ') ||
      'Unbenannt';

    return {
      success: true,
      data: {
        employee: {
          employeeRecordId: employee.id,
          userId,
          displayName,
        },
        teamNames: teamsResult.data.map((team) => team.name).sort(),
        capabilities: capabilityRows.flatMap((row) => {
          const definition = definitions.get(row.capability_id);
          return definition ? [{ definition, record: toEmployeeCapability(row) }] : [];
        }),
      },
    };
  } catch (error) {
    logError('Unexpected error in getOwnQualificationProfile:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function createTeam(rawInput: {
  name: string;
  description?: string | null;
}): Promise<ActionResult<{ teamId: string }>> {
  const parsedInput = createTeamSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }
    const name = input.name.trim();
    if (!name) return { success: false, error: 'invalid_input' };
    // One call creates the team and records its 'created' history row.
    const { data, error } = await createSupabaseAdminClient().rpc(
      'create_team',
      rpcArgs('create_team', {
        p_actor_id: auth.context.userId,
        p_organization_id: auth.context.orgId,
        p_name: name,
        p_description: normalizeOptionalText(input.description),
      }),
    );
    if (error || !data) return qualificationWriteFailure(error, 'create_failed', 'Failed to create team:');
    return { success: true, teamId: data };
  } catch (error) {
    logError('Unexpected error in createTeam:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateTeam(rawInput: {
  teamId: string;
  name: string;
  description?: string | null;
}): Promise<ActionResult> {
  const parsedInput = updateTeamSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const name = input.name.trim();
  if (!name) return { success: false, error: 'invalid_input' };
  // One call saves the team and records 'updated' with the name and
  // description it replaced, read under the lock.
  const { error } = await createSupabaseAdminClient().rpc(
    'update_team',
    rpcArgs('update_team', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_team_id: input.teamId,
      p_name: name,
      p_description: normalizeOptionalText(input.description),
    }),
  );
  if (error) return qualificationWriteFailure(error, 'update_failed', 'Failed to update team:');
  return { success: true };
}

export async function dissolveTeam(rawInput: {
  teamId: string;
  reason?: string | null;
}): Promise<ActionResult> {
  const parsedInput = dissolveTeamSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  // One call dissolves the team and records its 'dissolved' history row.
  const { error } = await createSupabaseAdminClient().rpc(
    'dissolve_team',
    rpcArgs('dissolve_team', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_team_id: input.teamId,
      p_reason: normalizeOptionalText(input.reason),
    }),
  );
  if (error) return qualificationWriteFailure(error, 'update_failed', 'Failed to dissolve team:');
  return { success: true };
}

export async function addTeamMembership(rawInput: {
  teamId: string;
  employeeRecordId: string;
  validFrom: string;
  validUntil?: string | null;
}): Promise<ActionResult> {
  const parsedInput = addTeamMembershipSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (
    !isIsoDate(input.validFrom) ||
    (input.validUntil && !isIsoDate(input.validUntil)) ||
    !isOrderedRange(input.validFrom, input.validUntil)
  ) {
    return { success: false, error: 'invalid_input' };
  }
  // One call checks the team and the employee under lock, adds the
  // membership and records its 'member_added' history row.
  const { error } = await createSupabaseAdminClient().rpc(
    'add_team_membership',
    rpcArgs('add_team_membership', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_team_id: input.teamId,
      p_employee_record_id: input.employeeRecordId,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil || null,
    }),
  );
  if (error) return qualificationWriteFailure(error, 'create_failed', 'Failed to add team membership:');
  return { success: true };
}

export async function endTeamMembership(rawInput: {
  membershipId: string;
  validUntil: string;
}): Promise<ActionResult> {
  const parsedInput = endTeamMembershipSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (!isIsoDate(input.validUntil)) {
    return { success: false, error: 'invalid_input' };
  }
  // One call checks the end against the start under lock, ends the
  // membership and records its 'member_ended' history row.
  const { error } = await createSupabaseAdminClient().rpc(
    'end_team_membership',
    rpcArgs('end_team_membership', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_membership_id: input.membershipId,
      p_valid_until: input.validUntil,
    }),
  );
  if (error) return qualificationWriteFailure(error, 'update_failed', 'Failed to end team membership:');
  return { success: true };
}

export async function createCapability(rawInput: {
  kind: CapabilityKind;
  name: string;
  description?: string | null;
  expiryWarningDays?: number;
}): Promise<ActionResult<{ capabilityId: string }>> {
  const parsedInput = createCapabilitySchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (!CAPABILITY_KINDS.includes(input.kind)) {
    return { success: false, error: 'invalid_input' };
  }
  const name = input.name.trim();
  const warningDays = input.kind === 'certification' ? (input.expiryWarningDays ?? 30) : 0;
  if (!name || !Number.isInteger(warningDays) || warningDays < 0 || warningDays > 365) {
    return { success: false, error: 'invalid_input' };
  }
  // One call creates the definition and records its 'definition_created'
  // history row.
  const { data, error } = await createSupabaseAdminClient().rpc(
    'create_capability_definition',
    rpcArgs('create_capability_definition', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_kind: input.kind,
      p_name: name,
      p_description: normalizeOptionalText(input.description),
      p_warning_days: warningDays,
    }),
  );
  if (error || !data) {
    return qualificationWriteFailure(error, 'create_failed', 'Failed to create capability definition:');
  }
  return { success: true, capabilityId: data };
}

export async function retireCapabilityDefinition(capabilityIdInput: string): Promise<ActionResult> {
  const parsedCapabilityId = uuidSchema.safeParse(capabilityIdInput);
  if (!parsedCapabilityId.success) return { success: false, error: 'invalid_input' };
  const capabilityId = parsedCapabilityId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  // One call retires the definition and records its 'definition_retired'
  // history row.
  const { error } = await createSupabaseAdminClient().rpc(
    'retire_capability_definition',
    rpcArgs('retire_capability_definition', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_capability_id: capabilityId,
    }),
  );
  if (error)
    return qualificationWriteFailure(error, 'update_failed', 'Failed to retire capability definition:');
  return { success: true };
}

export async function addEmployeeCapability(rawInput: {
  employeeRecordId: string;
  capabilityId: string;
  validFrom: string;
  validUntil?: string | null;
  issuer?: string | null;
  renewalDueDate?: string | null;
  confirmationStatus?: ConfirmationStatus;
  evidenceState?: EvidenceState;
  operationalNote?: string | null;
  supersedesId?: string | null;
}): Promise<ActionResult<{ recordId: string }>> {
  const parsedInput = addEmployeeCapabilitySchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (!isIsoDate(input.validFrom)) {
    return { success: false, error: 'invalid_input' };
  }
  if (
    (input.validUntil && !isIsoDate(input.validUntil)) ||
    (input.renewalDueDate && !isIsoDate(input.renewalDueDate))
  ) {
    return { success: false, error: 'invalid_input' };
  }
  if (!isOrderedRange(input.validFrom, input.validUntil)) {
    return { success: false, error: 'invalid_input' };
  }
  // One call checks the definition, the employee and a renewed record under
  // lock, stores the record (a renewal supersedes the current one) and records
  // its 'qualification_added' or 'qualification_renewed' history row.
  const { data: recordId, error } = await createSupabaseAdminClient().rpc(
    'add_employee_capability',
    rpcArgs('add_employee_capability', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_employee_record_id: input.employeeRecordId,
      p_capability_id: input.capabilityId,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil || null,
      p_issuer: normalizeOptionalText(input.issuer),
      p_renewal_due_date: input.renewalDueDate || null,
      p_confirmation_status: input.confirmationStatus ?? null,
      p_evidence_state: input.evidenceState ?? null,
      p_operational_note: normalizeOptionalText(input.operationalNote),
      p_supersedes_id: input.supersedesId || null,
    }),
  );
  if (error || !recordId)
    return qualificationWriteFailure(error, 'create_failed', 'Failed to add employee capability:');
  return { success: true, recordId };
}

export async function updateEmployeeCapability(rawInput: {
  recordId: string;
  validFrom: string;
  validUntil?: string | null;
  issuer?: string | null;
  renewalDueDate?: string | null;
  confirmationStatus: ConfirmationStatus;
  evidenceState: EvidenceState;
  operationalNote?: string | null;
}): Promise<ActionResult> {
  const parsedInput = updateEmployeeCapabilitySchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (
    !isIsoDate(input.validFrom) ||
    (input.validUntil && !isIsoDate(input.validUntil)) ||
    (input.renewalDueDate && !isIsoDate(input.renewalDueDate)) ||
    !CONFIRMATION_STATUSES.includes(input.confirmationStatus) ||
    !EVIDENCE_STATES.includes(input.evidenceState) ||
    !isOrderedRange(input.validFrom, input.validUntil)
  ) {
    return { success: false, error: 'invalid_input' };
  }
  // One call corrects the record under lock and records its
  // 'qualification_corrected' history row with the values before and after.
  const { error } = await createSupabaseAdminClient().rpc(
    'update_employee_capability',
    rpcArgs('update_employee_capability', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_record_id: input.recordId,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil || null,
      p_issuer: normalizeOptionalText(input.issuer),
      p_renewal_due_date: input.renewalDueDate || null,
      p_confirmation_status: input.confirmationStatus,
      p_evidence_state: input.evidenceState,
      p_operational_note: normalizeOptionalText(input.operationalNote),
    }),
  );
  if (error)
    return qualificationWriteFailure(error, 'update_failed', 'Failed to update employee capability:');
  return { success: true };
}

export async function setApprenticeWarningEnabled(enabledInput: boolean): Promise<ActionResult> {
  const parsedEnabled = z.boolean().safeParse(enabledInput);
  if (!parsedEnabled.success) return { success: false, error: 'invalid_input' };
  const enabled = parsedEnabled.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (auth.context.role !== 'admin') {
    return { success: false, error: 'not_authorized' };
  }
  // One call saves the setting, creating the row on first use, and records
  // its 'apprentice_warning_changed' history row.
  const { error } = await createSupabaseAdminClient().rpc(
    'set_apprentice_warning_enabled',
    rpcArgs('set_apprentice_warning_enabled', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_enabled: enabled,
    }),
  );
  if (error) return qualificationWriteFailure(error, 'update_failed', 'Failed to save apprentice warning:');
  return { success: true };
}

export async function setJobCapabilityRequirements(rawInput: {
  jobId: string;
  requirements: Array<{
    capabilityId: string;
    requireConfirmation: boolean;
  }>;
}): Promise<ActionResult> {
  const parsedInput = jobRequirementsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobError } = await loggedRead(
    'setJobCapabilityRequirements: jobs read failed',
    admin
      .from('jobs')
      .select('id')
      .eq('id', input.jobId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (jobError) return { success: false, error: 'load_failed' };
  if (!job) return { success: false, error: 'job_not_found' };
  const normalized = [
    ...new Map(input.requirements.map((requirement) => [requirement.capabilityId, requirement])).values(),
  ];
  if (normalized.length > 100) {
    return { success: false, error: 'invalid_input' };
  }
  const { error } = await admin.rpc('replace_job_capability_requirements', {
    p_organization_id: auth.context.orgId,
    p_job_id: input.jobId,
    p_capability_ids: normalized.map((requirement) => requirement.capabilityId),
    p_require_confirmations: normalized.map((requirement) => requirement.requireConfirmation),
    p_actor_id: auth.context.userId,
  });
  if (error) {
    logError('Failed to replace job capability requirements:', error);
    return { success: false, error: 'update_failed' };
  }
  return { success: true };
}

export async function getJobQualificationDetail(
  jobIdInput: string,
): Promise<{ success: true; data: JobQualificationDetail } | ActionFailure> {
  const parsedJobId = uuidSchema.safeParse(jobIdInput);
  if (!parsedJobId.success) return { success: false, error: 'invalid_input' };
  const jobId = parsedJobId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: job, error: jobError } = await admin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();
  if (jobError || !job) {
    logReadErrors('getJobQualificationDetail: read failed', jobError);
    return { success: false, error: 'job_not_found' };
  }
  const [definitionsResult, requirementsResult, assignmentsResult, latestResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_capabilities')
          .select('*')
          .eq('organization_id', auth.context.orgId)
          .is('retired_at', null)
          .order('name', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    admin
      .from('job_capability_requirements')
      .select('id, capability_id, require_confirmation')
      .eq('organization_id', auth.context.orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(100),
    admin
      .from('job_assignments')
      .select('user_id')
      .eq('organization_id', auth.context.orgId)
      .eq('job_id', jobId)
      .limit(201),
    admin
      .from('job_qualification_assessments')
      .select('created_at, override_reason, coverage_fingerprint')
      .eq('organization_id', auth.context.orgId)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const error =
    definitionsResult.error ?? requirementsResult.error ?? assignmentsResult.error ?? latestResult.error;
  if (error) {
    logError('Failed to load job qualification detail:', error);
    return { success: false, error: 'load_failed' };
  }
  const evaluationResult = await loadAssignmentEvaluation({
    admin,
    orgId: auth.context.orgId,
    jobId,
    selectedUserIds: (assignmentsResult.data ?? []).map((row) => row.user_id),
  });
  if (!evaluationResult.success) return evaluationResult;
  const definitions = definitionsResult.data.map(toCapabilityDefinition);
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  return {
    success: true,
    data: {
      capabilities: definitions,
      requirements: (requirementsResult.data ?? []).flatMap((row) => {
        const definition = definitionById.get(row.capability_id);
        return definition
          ? [
              {
                id: row.id,
                capabilityId: definition.id,
                capabilityName: definition.name,
                capabilityKind: definition.kind,
                requireConfirmation: row.require_confirmation,
              },
            ]
          : [];
      }),
      evaluation: evaluationResult.evaluation,
      latestAssessment: latestResult.data
        ? {
            createdAt: latestResult.data.created_at,
            overrideReason: latestResult.data.override_reason,
            coverageFingerprint: latestResult.data.coverage_fingerprint,
          }
        : null,
    },
  };
}

type ProjectCapabilityRequirement = {
  id: string;
  capability_id: string;
  require_confirmation: boolean;
};

type ProjectCapabilityRequirementsResult =
  | {
      success: true;
      data: {
        capabilities: CapabilityDefinition[];
        requirements: ProjectCapabilityRequirement[];
      };
    }
  | ActionFailure;

type SetProjectCapabilityRequirementsResult = ActionResult;

export async function getProjectCapabilityRequirements(
  projectIdInput: string,
): Promise<ProjectCapabilityRequirementsResult> {
  const parsedProjectId = uuidSchema.safeParse(projectIdInput);
  if (!parsedProjectId.success) return { success: false, error: 'invalid_input' };
  const projectId = parsedProjectId.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data: project, error: projectError } = await loggedRead(
    'getProjectCapabilityRequirements: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (projectError) return { success: false as const, error: 'load_failed' };
  if (!project) return { success: false as const, error: 'project_not_found' };
  const [definitionsResult, requirementsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_capabilities')
          .select('*')
          .eq('organization_id', auth.context.orgId)
          .is('retired_at', null)
          .order('name')
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    admin
      .from('job_capability_requirements')
      .select('id, capability_id, require_confirmation')
      .eq('organization_id', auth.context.orgId)
      .eq('project_id', projectId)
      .order('created_at')
      .limit(201),
  ]);
  // A project holds at most 200 requirements (the write path refuses more).
  if (definitionsResult.error || requirementsResult.error || (requirementsResult.data?.length ?? 0) > 200) {
    logError(
      'Failed to load project capability requirements:',
      definitionsResult.error ?? requirementsResult.error ?? { code: 'requirement_overflow' },
    );
    return { success: false as const, error: 'load_failed' };
  }
  return {
    success: true as const,
    data: {
      capabilities: definitionsResult.data.map(toCapabilityDefinition),
      requirements: requirementsResult.data ?? [],
    },
  };
}

export async function setProjectCapabilityRequirements(rawInput: {
  projectId: string;
  requirements: Array<{ capabilityId: string; requireConfirmation: boolean }>;
  expectedRequirements: Array<{ capabilityId: string; requireConfirmation: boolean }>;
}): Promise<SetProjectCapabilityRequirementsResult> {
  const parsedInput = projectRequirementsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const normalized = [
    ...new Map(input.requirements.map((requirement) => [requirement.capabilityId, requirement])).values(),
  ].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  const expected = [
    ...new Map(
      input.expectedRequirements.map((requirement) => [requirement.capabilityId, requirement]),
    ).values(),
  ].sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
  if (normalized.length > 200) return { success: false as const, error: 'invalid_input' };
  const { error } = await createSupabaseAdminClient().rpc('replace_project_capability_requirements_checked', {
    p_organization_id: auth.context.orgId,
    p_project_id: input.projectId,
    p_capability_ids: normalized.map((requirement) => requirement.capabilityId),
    p_require_confirmations: normalized.map((requirement) => requirement.requireConfirmation),
    p_expected_capability_ids: expected.map((requirement) => requirement.capabilityId),
    p_expected_require_confirmations: expected.map((requirement) => requirement.requireConfirmation),
    p_actor_id: auth.context.userId,
  });
  if (error) {
    return {
      success: false as const,
      error: error.message.includes('project_capability_requirements_conflict')
        ? 'conflict'
        : 'update_failed',
    };
  }
  return { success: true as const };
}

export async function expandTeamForAssignment(rawInput: {
  teamId: string;
  assessedForDate?: string | null;
}): Promise<
  | {
      success: true;
      userIds: string[];
      skippedNames: string[];
      teamSourceId: string;
    }
  | ActionFailure
> {
  const parsedInput = expandTeamSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (input.assessedForDate && !isIsoDate(input.assessedForDate)) {
    return { success: false, error: 'invalid_input' };
  }
  const date = input.assessedForDate || getBusinessTodayIso();
  const admin = createSupabaseAdminClient();
  const { data: team, error: teamError } = await loggedRead(
    'expandTeamForAssignment: teams read failed',
    admin
      .from('teams')
      .select('id')
      .eq('id', input.teamId)
      .eq('organization_id', auth.context.orgId)
      .is('dissolved_at', null)
      .maybeSingle(),
  );
  if (teamError) return { success: false, error: 'load_failed' };
  if (!team) return { success: false, error: 'team_not_found' };
  const teamExpansionFailed = (read: string, readError: unknown): ActionFailure => {
    logError(`Failed to expand team for assignment (${read}):`, readError);
    return { success: false, error: 'load_failed' };
  };
  // A team may hold every employee of the company: complete pages, then id batches.
  const { data: memberships, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('team_memberships')
        .select('employee_record_id')
        .eq('organization_id', auth.context.orgId)
        .eq('team_id', input.teamId)
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
      .eq('organization_id', auth.context.orgId)
      .in('id', [...batch]),
  );
  if (recordsResult.error) return teamExpansionFailed('employee records', recordsResult.error);
  const records = recordsResult.data.sort((left, right) => left.id.localeCompare(right.id));
  const linkedUserIds = records.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const { data: memberRows, error: membersError } = await readInBatches(linkedUserIds, (batch) =>
    admin
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', auth.context.orgId)
      .in('user_id', [...batch]),
  );
  if (membersError) return teamExpansionFailed('organization members', membersError);
  const activeMemberIds = new Set(memberRows.map((row) => row.user_id));
  return {
    success: true,
    userIds: records
      .map((row) => row.user_id)
      .filter((id): id is string => Boolean(id && activeMemberIds.has(id))),
    skippedNames: records
      .filter((row) => !row.user_id || !activeMemberIds.has(row.user_id))
      .map((row) => [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Unbenannt'),
    teamSourceId: input.teamId,
  };
}

export async function getAssignmentTeamOptions(): Promise<
  { success: true; teams: Array<{ id: string; name: string }> } | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('teams')
        .select('id, name')
        .eq('organization_id', auth.context.orgId)
        .is('dissolved_at', null)
        .order('name', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('Failed to load assignment team options:', error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, teams: data };
}
