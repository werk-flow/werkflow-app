'use server';

import { loggedRead } from '@/lib/data/read-request-cache';
import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { normalizeOptionalText } from '@/lib/validation/text';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import {
  CAPABILITY_KINDS,
  CONFIRMATION_STATUSES,
  EVIDENCE_STATES,
  type CapabilityKind,
  type ConfirmationStatus,
  type EvidenceState,
  type OwnQualificationProfile,
} from './types';
import {
  expandTeamMembers,
  readCurrentQualificationRows,
  readQualificationReferences,
} from './qualification-reads';
import { toCapabilityDefinition, toEmployeeCapability } from './server';
import { logError } from '@/lib/logging';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

// Boundary schemas: types, ids and bounds. The date and name rules below keep
// their own error codes for the forms.
const qualificationDate = z.string().max(10);
const qualificationNote = z.string().max(2000).nullable().optional();
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
const qualificationWriteFailure = writeRefusalFor(QUALIFICATION_WRITE_REFUSALS);

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
    const [[membershipsResult, capabilityRowsResult], profileResult] = await Promise.all([
      readCurrentQualificationRows(admin, orgId, employee.id, today),
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
    const [teamsResult, definitionsResult] = await readQualificationReferences(
      admin,
      orgId,
      teamIds,
      definitionIds,
    );
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
  const expansion = await expandTeamMembers(admin, auth.context.orgId, input.teamId, date);
  if (!expansion) return { success: false, error: 'load_failed' };
  return { success: true, ...expansion, teamSourceId: input.teamId };
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
