'use server';

import { updateTag } from 'next/cache';
import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import {
  CAPABILITY_KINDS,
  CONFIRMATION_STATUSES,
  EVIDENCE_STATES,
  type AssignmentEvaluation,
  type CapabilityKind,
  type ConfirmationStatus,
  type EvidenceState,
  type QualificationWorkspace,
  type OwnQualificationProfile,
  type JobQualificationDetail,
  type PersonnelQualificationSummary,
} from './types';
import {
  loadAssignmentEvaluation,
  toCapabilityDefinition,
  toEmployeeCapability,
} from './server';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && ISO_DATE_PATTERN.test(value));
}

function isOrderedRange(
  validFrom: string,
  validUntil: string | null | undefined
): boolean {
  return !validUntil || validUntil >= validFrom;
}

async function recordTeamEvent(input: {
  orgId: string;
  teamId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorId: string;
}): Promise<void> {
  const { error } = await createSupabaseAdminClient().from('team_events').insert({
    organization_id: input.orgId,
    team_id: input.teamId,
    event_type: input.eventType,
    event_payload: input.payload ?? {},
    created_by: input.actorId,
  });
  if (error) console.error('Failed to record team event:', error);
}

async function recordQualificationEvent(input: {
  orgId: string;
  capabilityId?: string | null;
  eventType: string;
  payload?: Record<string, unknown>;
  actorId: string;
}): Promise<void> {
  const { error } = await createSupabaseAdminClient()
    .from('qualification_events')
    .insert({
      organization_id: input.orgId,
      capability_id: input.capabilityId ?? null,
      event_type: input.eventType,
      event_payload: input.payload ?? {},
      created_by: input.actorId,
    });
  if (error) console.error('Failed to record qualification event:', error);
}

async function recordEmployeeQualificationEvent(input: {
  orgId: string;
  employeeRecordId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  actorId: string;
}): Promise<void> {
  const { error } = await createSupabaseAdminClient()
    .from('employee_record_events')
    .insert({
      organization_id: input.orgId,
      employee_record_id: input.employeeRecordId,
      event_type: input.eventType,
      event_payload: input.payload ?? {},
      created_by: input.actorId,
    });
  if (error) console.error('Failed to record employee qualification event:', error);
}

export async function getQualificationWorkspace(): Promise<
  | { success: true; data: QualificationWorkspace }
  | { success: false; error: string }
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
      admin
        .from('teams')
        .select('*')
        .eq('organization_id', orgId)
        .order('dissolved_at', { ascending: true, nullsFirst: true })
        .order('name', { ascending: true })
        .limit(501),
      admin
        .from('team_memberships')
        .select('*')
        .eq('organization_id', orgId)
        .order('valid_from', { ascending: false })
        .limit(1001),
      admin
        .from('organization_capabilities')
        .select('*')
        .eq('organization_id', orgId)
        .order('retired_at', { ascending: true, nullsFirst: true })
        .order('kind', { ascending: true })
        .order('name', { ascending: true })
        .limit(501),
      admin
        .from('employee_capabilities')
        .select('*')
        .eq('organization_id', orgId)
        .order('valid_from', { ascending: false })
        .limit(2001),
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', orgId)
        .order('last_name', { ascending: true, nullsFirst: false })
        .limit(501),
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
      console.error('Failed to load qualification workspace:', firstError);
      return { success: false, error: 'load_failed' };
    }
    if (
      (teamsResult.data?.length ?? 0) > 500 ||
      (membershipsResult.data?.length ?? 0) > 1000 ||
      (definitionsResult.data?.length ?? 0) > 500 ||
      (employeeCapabilitiesResult.data?.length ?? 0) > 2000 ||
      (employeesResult.data?.length ?? 0) > 500
    ) {
      console.error('Qualification workspace size limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const userIds = (employeesResult.data ?? [])
      .map((row) => row.user_id)
      .filter((id): id is string => Boolean(id));
    const { data: profiles, error: profilesError } =
      userIds.length > 0
        ? await admin
            .from('profiles')
            .select('id, first_name, last_name')
            .in('id', userIds)
            .order('id', { ascending: true })
            .limit(501)
        : { data: [], error: null };
    if (profilesError) {
      console.error('Failed to load qualification profile names:', profilesError);
      return { success: false, error: 'load_failed' };
    }
    if ((profiles?.length ?? 0) > 500) {
      console.error('Qualification profile name limit exceeded.');
      return { success: false, error: 'load_failed' };
    }
    const profileNames = new Map(
      (profiles ?? []).map((profile) => [
        profile.id,
        [profile.first_name, profile.last_name].filter(Boolean).join(' '),
      ])
    );

    return {
      success: true,
      data: {
        teams: (teamsResult.data ?? []).map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          name: row.name,
          description: row.description,
          dissolvedAt: row.dissolved_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        teamMemberships: (membershipsResult.data ?? []).map((row) => ({
          id: row.id,
          organizationId: row.organization_id,
          teamId: row.team_id,
          employeeRecordId: row.employee_record_id,
          validFrom: row.valid_from,
          validUntil: row.valid_until,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        capabilities: (definitionsResult.data ?? []).map(toCapabilityDefinition),
        employeeCapabilities: (employeeCapabilitiesResult.data ?? []).map(
          toEmployeeCapability
        ),
        employees: (employeesResult.data ?? []).map((row) => ({
          employeeRecordId: row.id,
          userId: row.user_id,
          displayName:
            (row.user_id ? profileNames.get(row.user_id) : null) ||
            [row.first_name, row.last_name].filter(Boolean).join(' ') ||
            'Unbenannt',
        })),
        apprenticeWarningEnabled:
          settingsResult.data?.apprentice_warning_enabled ?? false,
        isAdmin: role === 'admin',
      },
    };
  } catch (error) {
    console.error('Unexpected error in getQualificationWorkspace:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getPersonnelQualificationSummary(
  employeeRecordIdOrUserId: string
): Promise<
  | { success: true; data: PersonnelQualificationSummary | null }
  | { success: false; error: string }
> {
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
      console.error('Failed to resolve qualification employee:', byUserResult.error);
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
        console.error(
          'Failed to resolve qualification employee record:',
          byRecordResult.error
        );
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
      console.error(
        'Failed to load personnel qualification summary:',
        membershipsResult.error ?? capabilityRowsResult.error
      );
      return { success: false, error: 'load_failed' };
    }
    if (
      (membershipsResult.data?.length ?? 0) > 500 ||
      (capabilityRowsResult.data?.length ?? 0) > 500
    ) {
      console.error('Personnel qualification summary size limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const teamIds = [
      ...new Set((membershipsResult.data ?? []).map((row) => row.team_id)),
    ];
    const capabilityIds = [
      ...new Set(
        (capabilityRowsResult.data ?? []).map((row) => row.capability_id)
      ),
    ];
    const [teamsResult, definitionsResult] = await Promise.all([
      teamIds.length > 0
        ? admin
            .from('teams')
            .select('id, name')
            .eq('organization_id', orgId)
            .is('dissolved_at', null)
            .in('id', teamIds)
            .limit(501)
        : Promise.resolve({ data: [], error: null }),
      capabilityIds.length > 0
        ? admin
            .from('organization_capabilities')
            .select('*')
            .eq('organization_id', orgId)
            .in('id', capabilityIds)
            .limit(501)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (teamsResult.error || definitionsResult.error) {
      console.error(
        'Failed to load personnel qualification references:',
        teamsResult.error ?? definitionsResult.error
      );
      return { success: false, error: 'load_failed' };
    }
    if (
      (teamsResult.data?.length ?? 0) > 500 ||
      (definitionsResult.data?.length ?? 0) > 500
    ) {
      console.error('Personnel qualification reference limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const definitionById = new Map(
      (definitionsResult.data ?? []).map((row) => [
        row.id,
        toCapabilityDefinition(row),
      ])
    );
    return {
      success: true,
      data: {
        teamNames: (teamsResult.data ?? [])
          .map((team) => team.name)
          .sort((left, right) => left.localeCompare(right, 'de-DE')),
        entries: (capabilityRowsResult.data ?? []).flatMap((row) => {
          const definition = definitionById.get(row.capability_id);
          return definition
            ? [{ definition, record: toEmployeeCapability(row) }]
            : [];
        }),
      },
    };
  } catch (error) {
    console.error('Unexpected error in getPersonnelQualificationSummary:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getOwnQualificationProfile(): Promise<
  | { success: true; data: OwnQualificationProfile | null }
  | { success: false; error: string }
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
    if (error) return { success: false, error: 'load_failed' };
    if (!employee) return { success: true, data: null };

    const [membershipsResult, capabilityRowsResult, profileResult] =
      await Promise.all([
        admin
          .from('team_memberships')
          .select('team_id')
          .eq('organization_id', orgId)
          .eq('employee_record_id', employee.id)
          .lte('valid_from', getBusinessTodayIso())
          .or(
            `valid_until.gte.${getBusinessTodayIso()},valid_until.is.null`
          )
          .limit(501),
        admin
          .from('employee_capabilities')
          .select('*')
          .eq('organization_id', orgId)
          .eq('employee_record_id', employee.id)
          .is('superseded_at', null)
          .order('valid_from', { ascending: false })
          .limit(500),
        admin
          .from('profiles')
          .select('first_name, last_name')
          .eq('id', userId)
          .maybeSingle(),
      ]);
    if (
      membershipsResult.error ||
      capabilityRowsResult.error ||
      profileResult.error
    ) {
      console.error(
        'Failed to load own qualification profile:',
        membershipsResult.error ?? capabilityRowsResult.error ?? profileResult.error
      );
      return { success: false, error: 'load_failed' };
    }
    if ((membershipsResult.data?.length ?? 0) > 500) {
      console.error('Own qualification membership limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const teamIds = (membershipsResult.data ?? []).map((row) => row.team_id);
    const capabilityRows = capabilityRowsResult.data ?? [];
    const definitionIds = [
      ...new Set(capabilityRows.map((row) => row.capability_id)),
    ];
    const [teamsResult, definitionsResult] = await Promise.all([
      teamIds.length > 0
        ? admin
            .from('teams')
            .select('id, name')
            .eq('organization_id', orgId)
            .is('dissolved_at', null)
            .in('id', teamIds)
            .order('id', { ascending: true })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      definitionIds.length > 0
        ? admin
            .from('organization_capabilities')
            .select('*')
            .eq('organization_id', orgId)
            .in('id', definitionIds)
            .order('id', { ascending: true })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (teamsResult.error || definitionsResult.error) {
      return { success: false, error: 'load_failed' };
    }
    const definitions = new Map(
      (definitionsResult.data ?? []).map((row) => [
        row.id,
        toCapabilityDefinition(row),
      ])
    );
    const displayName =
      [
        profileResult.data?.first_name,
        profileResult.data?.last_name,
      ]
        .filter(Boolean)
        .join(' ') ||
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
        teamNames: (teamsResult.data ?? []).map((team) => team.name).sort(),
        capabilities: capabilityRows.flatMap((row) => {
          const definition = definitions.get(row.capability_id);
          return definition
            ? [{ definition, record: toEmployeeCapability(row) }]
            : [];
        }),
      },
    };
  } catch (error) {
    console.error('Unexpected error in getOwnQualificationProfile:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function evaluateJobAssignment(input: {
  jobId?: string | null;
  selectedUserIds: string[];
  assessedForDate?: string | null;
}): Promise<
  | { success: true; evaluation: AssignmentEvaluation }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  return loadAssignmentEvaluation({
    admin: createSupabaseAdminClient(),
    orgId: auth.context.orgId,
    jobId: input.jobId,
    selectedUserIds: input.selectedUserIds,
    assessedForDate: input.assessedForDate,
  });
}

export async function createTeam(input: {
  name: string;
  description?: string | null;
}): Promise<{ success: boolean; error?: string; teamId?: string }> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }
    const name = input.name.trim();
    if (!name) return { success: false, error: 'invalid_input' };
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from('teams')
      .insert({
        organization_id: auth.context.orgId,
        name,
        description: normalizeOptionalText(input.description),
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
      })
      .select('id')
      .single();
    if (error || !data) {
      return {
        success: false,
        error: error?.code === '23505' ? 'duplicate_name' : 'create_failed',
      };
    }
    await recordTeamEvent({
      orgId: auth.context.orgId,
      teamId: data.id,
      eventType: 'created',
      payload: { name },
      actorId: auth.context.userId,
    });
    updateTag(CACHE_TAGS.teams(auth.context.orgId));
    return { success: true, teamId: data.id };
  } catch (error) {
    console.error('Unexpected error in createTeam:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function updateTeam(input: {
  teamId: string;
  name: string;
  description?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from('teams')
    .select('name, description')
    .eq('id', input.teamId)
    .eq('organization_id', auth.context.orgId)
    .is('dissolved_at', null)
    .maybeSingle();
  if (!current) return { success: false, error: 'team_not_found' };
  const name = input.name.trim();
  if (!name) return { success: false, error: 'invalid_input' };
  const description = normalizeOptionalText(input.description);
  const { error } = await admin
    .from('teams')
    .update({
      name,
      description,
      updated_by: auth.context.userId,
    })
    .eq('id', input.teamId)
    .eq('organization_id', auth.context.orgId);
  if (error) {
    return {
      success: false,
      error: error.code === '23505' ? 'duplicate_name' : 'update_failed',
    };
  }
  await recordTeamEvent({
    orgId: auth.context.orgId,
    teamId: input.teamId,
    eventType: 'updated',
    payload: {
      changes: {
        name: { from: current.name, to: name },
        description: { from: current.description, to: description },
      },
    },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.teams(auth.context.orgId));
  return { success: true };
}

export async function dissolveTeam(input: {
  teamId: string;
  reason?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const now = new Date().toISOString();
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('teams')
    .update({
      dissolved_at: now,
      updated_by: auth.context.userId,
    })
    .eq('id', input.teamId)
    .eq('organization_id', auth.context.orgId)
    .is('dissolved_at', null)
    .select('id')
    .maybeSingle();
  if (error || !data) return { success: false, error: 'team_not_found' };
  await recordTeamEvent({
    orgId: auth.context.orgId,
    teamId: input.teamId,
    eventType: 'dissolved',
    payload: { reason: normalizeOptionalText(input.reason) },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.teams(auth.context.orgId));
  return { success: true };
}

export async function addTeamMembership(input: {
  teamId: string;
  employeeRecordId: string;
  validFrom: string;
  validUntil?: string | null;
}): Promise<{ success: boolean; error?: string }> {
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
  const admin = createSupabaseAdminClient();
  const [teamResult, employeeResult] = await Promise.all([
    admin
      .from('teams')
      .select('id')
      .eq('id', input.teamId)
      .eq('organization_id', auth.context.orgId)
      .is('dissolved_at', null)
      .maybeSingle(),
    admin
      .from('employee_records')
      .select('id')
      .eq('id', input.employeeRecordId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  ]);
  if (!teamResult.data) return { success: false, error: 'team_not_found' };
  if (!employeeResult.data) return { success: false, error: 'employee_not_found' };
  const { data, error } = await admin
    .from('team_memberships')
    .insert({
      organization_id: auth.context.orgId,
      team_id: input.teamId,
      employee_record_id: input.employeeRecordId,
      valid_from: input.validFrom,
      valid_until: input.validUntil || null,
      created_by: auth.context.userId,
    })
    .select('id')
    .single();
  if (error || !data) {
    return {
      success: false,
      error: error?.code === '23P01' ? 'overlap' : 'create_failed',
    };
  }
  await recordTeamEvent({
    orgId: auth.context.orgId,
    teamId: input.teamId,
    eventType: 'member_added',
    payload: {
      membership_id: data.id,
      employee_record_id: input.employeeRecordId,
      valid_from: input.validFrom,
      valid_until: input.validUntil || null,
    },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.teams(auth.context.orgId));
  return { success: true };
}

export async function endTeamMembership(input: {
  membershipId: string;
  validUntil: string;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (!isIsoDate(input.validUntil)) {
    return { success: false, error: 'invalid_input' };
  }
  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin
    .from('team_memberships')
    .select('valid_from')
    .eq('id', input.membershipId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();
  if (!membership) return { success: false, error: 'record_not_found' };
  if (!isOrderedRange(membership.valid_from, input.validUntil)) {
    return { success: false, error: 'invalid_input' };
  }
  const { data, error } = await admin
    .from('team_memberships')
    .update({
      valid_until: input.validUntil,
      ended_by: auth.context.userId,
    })
    .eq('id', input.membershipId)
    .eq('organization_id', auth.context.orgId)
    .select('team_id, employee_record_id')
    .maybeSingle();
  if (error || !data) return { success: false, error: 'update_failed' };
  await recordTeamEvent({
    orgId: auth.context.orgId,
    teamId: data.team_id,
    eventType: 'member_ended',
    payload: {
      membership_id: input.membershipId,
      employee_record_id: data.employee_record_id,
      valid_until: input.validUntil,
    },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.teams(auth.context.orgId));
  return { success: true };
}

export async function createCapability(input: {
  kind: CapabilityKind;
  name: string;
  description?: string | null;
  expiryWarningDays?: number;
}): Promise<{ success: boolean; error?: string; capabilityId?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  if (!CAPABILITY_KINDS.includes(input.kind)) {
    return { success: false, error: 'invalid_input' };
  }
  const name = input.name.trim();
  const warningDays =
    input.kind === 'certification' ? input.expiryWarningDays ?? 30 : 0;
  if (
    !name ||
    !Number.isInteger(warningDays) ||
    warningDays < 0 ||
    warningDays > 365
  ) {
    return { success: false, error: 'invalid_input' };
  }
  const { data, error } = await createSupabaseAdminClient()
    .from('organization_capabilities')
    .insert({
      organization_id: auth.context.orgId,
      kind: input.kind,
      name,
      description: normalizeOptionalText(input.description),
      default_expiry_warning_days: warningDays,
      created_by: auth.context.userId,
      updated_by: auth.context.userId,
    })
    .select('id')
    .single();
  if (error || !data) {
    return {
      success: false,
      error: error?.code === '23505' ? 'duplicate_name' : 'create_failed',
    };
  }
  await recordQualificationEvent({
    orgId: auth.context.orgId,
    capabilityId: data.id,
    eventType: 'definition_created',
    payload: { kind: input.kind, name, warning_days: warningDays },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  return { success: true, capabilityId: data.id };
}

export async function updateCapabilityDefinition(input: {
  capabilityId: string;
  name: string;
  description?: string | null;
  expiryWarningDays?: number;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from('organization_capabilities')
    .select('kind, name, description, default_expiry_warning_days')
    .eq('id', input.capabilityId)
    .eq('organization_id', auth.context.orgId)
    .is('retired_at', null)
    .maybeSingle();
  if (!current) return { success: false, error: 'definition_not_found' };
  const warningDays =
    current.kind === 'certification'
      ? input.expiryWarningDays ?? current.default_expiry_warning_days
      : 0;
  const name = input.name.trim();
  if (
    !name ||
    !Number.isInteger(warningDays) ||
    warningDays < 0 ||
    warningDays > 365
  ) {
    return { success: false, error: 'invalid_input' };
  }
  const description = normalizeOptionalText(input.description);
  const { error } = await admin
    .from('organization_capabilities')
    .update({
      name,
      description,
      default_expiry_warning_days: warningDays,
      updated_by: auth.context.userId,
    })
    .eq('id', input.capabilityId)
    .eq('organization_id', auth.context.orgId);
  if (error) {
    return {
      success: false,
      error: error.code === '23505' ? 'duplicate_name' : 'update_failed',
    };
  }
  await recordQualificationEvent({
    orgId: auth.context.orgId,
    capabilityId: input.capabilityId,
    eventType: 'definition_updated',
    payload: {
      changes: {
        name: { from: current.name, to: name },
        description: { from: current.description, to: description },
        warning_days: {
          from: current.default_expiry_warning_days,
          to: warningDays,
        },
      },
    },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  return { success: true };
}

export async function retireCapabilityDefinition(
  capabilityId: string
): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const { data, error } = await createSupabaseAdminClient()
    .from('organization_capabilities')
    .update({
      retired_at: new Date().toISOString(),
      updated_by: auth.context.userId,
    })
    .eq('id', capabilityId)
    .eq('organization_id', auth.context.orgId)
    .is('retired_at', null)
    .select('id')
    .maybeSingle();
  if (error || !data) return { success: false, error: 'definition_not_found' };
  await recordQualificationEvent({
    orgId: auth.context.orgId,
    capabilityId,
    eventType: 'definition_retired',
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  return { success: true };
}

export async function addEmployeeCapability(input: {
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
}): Promise<{ success: boolean; error?: string; recordId?: string }> {
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
  const admin = createSupabaseAdminClient();
  const [definitionResult, employeeResult] = await Promise.all([
    admin
      .from('organization_capabilities')
      .select('kind')
      .eq('id', input.capabilityId)
      .eq('organization_id', auth.context.orgId)
      .is('retired_at', null)
      .maybeSingle(),
    admin
      .from('employee_records')
      .select('id')
      .eq('id', input.employeeRecordId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  ]);
  const definition = definitionResult.data;
  if (!definition) return { success: false, error: 'definition_not_found' };
  if (!employeeResult.data) return { success: false, error: 'employee_not_found' };
  const confirmationStatus =
    definition.kind === 'certification'
      ? input.confirmationStatus ?? 'unconfirmed'
      : 'unconfirmed';
  const evidenceState =
    definition.kind === 'certification'
      ? input.evidenceState ?? 'not_required'
      : 'not_required';
  if (
    !CONFIRMATION_STATUSES.includes(confirmationStatus) ||
    !EVIDENCE_STATES.includes(evidenceState)
  ) {
    return { success: false, error: 'invalid_input' };
  }
  const now = new Date().toISOString();
  const insertPayload = {
      organization_id: auth.context.orgId,
      employee_record_id: input.employeeRecordId,
      capability_id: input.capabilityId,
      capability_kind: definition.kind,
      valid_from: input.validFrom,
      valid_until: input.validUntil || null,
      issuer:
        definition.kind === 'certification'
          ? normalizeOptionalText(input.issuer)
          : null,
      renewal_due_date:
        definition.kind === 'certification'
          ? input.renewalDueDate || null
          : null,
      confirmation_status: confirmationStatus,
      confirmed_by:
        confirmationStatus === 'confirmed' ? auth.context.userId : null,
      confirmed_at: confirmationStatus === 'confirmed' ? now : null,
      evidence_state: evidenceState,
      operational_note: normalizeOptionalText(input.operationalNote),
      supersedes_id: input.supersedesId || null,
      created_by: auth.context.userId,
      updated_by: auth.context.userId,
    };
  let recordId: string | null = null;
  let writeError: { code?: string; message?: string } | null = null;
  if (input.supersedesId) {
    const { data, error } = await admin.rpc('renew_employee_capability', {
      p_organization_id: auth.context.orgId,
      p_employee_record_id: input.employeeRecordId,
      p_capability_id: input.capabilityId,
      p_valid_from: input.validFrom,
      p_valid_until: input.validUntil || null,
      p_issuer: insertPayload.issuer,
      p_renewal_due_date: input.renewalDueDate || null,
      p_confirmation_status: confirmationStatus,
      p_evidence_state: evidenceState,
      p_operational_note: insertPayload.operational_note,
      p_supersedes_id: input.supersedesId,
      p_actor_id: auth.context.userId,
    });
    recordId = data;
    writeError = error;
  } else {
    const { data, error } = await admin
      .from('employee_capabilities')
      .insert(insertPayload)
      .select('id')
      .single();
    recordId = data?.id ?? null;
    writeError = error;
  }
  if (writeError || !recordId) {
    return {
      success: false,
      error:
        writeError?.code === '23P01' || writeError?.code === '23505'
          ? 'overlap'
          : 'create_failed',
    };
  }
  await recordEmployeeQualificationEvent({
    orgId: auth.context.orgId,
    employeeRecordId: input.employeeRecordId,
    eventType: input.supersedesId
      ? 'qualification_renewed'
      : 'qualification_added',
    payload: {
      employee_capability_id: recordId,
      capability_id: input.capabilityId,
      kind: definition.kind,
      valid_from: input.validFrom,
      valid_until: input.validUntil || null,
      supersedes_id: input.supersedesId || null,
    },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  return { success: true, recordId };
}

export async function updateEmployeeCapability(input: {
  recordId: string;
  validFrom: string;
  validUntil?: string | null;
  issuer?: string | null;
  renewalDueDate?: string | null;
  confirmationStatus: ConfirmationStatus;
  evidenceState: EvidenceState;
  operationalNote?: string | null;
}): Promise<{ success: boolean; error?: string }> {
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
  const admin = createSupabaseAdminClient();
  const { data: current } = await admin
    .from('employee_capabilities')
    .select('*')
    .eq('id', input.recordId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();
  if (!current) return { success: false, error: 'record_not_found' };
  const now = new Date().toISOString();
  const isCertification = current.capability_kind === 'certification';
  const update = {
    valid_from: input.validFrom,
    valid_until: input.validUntil || null,
    issuer: isCertification ? normalizeOptionalText(input.issuer) : null,
    renewal_due_date: isCertification ? input.renewalDueDate || null : null,
    confirmation_status: isCertification
      ? input.confirmationStatus
      : ('unconfirmed' as const),
    confirmed_by:
      isCertification && input.confirmationStatus === 'confirmed'
        ? auth.context.userId
        : null,
    confirmed_at:
      isCertification && input.confirmationStatus === 'confirmed' ? now : null,
    evidence_state: isCertification ? input.evidenceState : ('not_required' as const),
    operational_note: normalizeOptionalText(input.operationalNote),
    updated_by: auth.context.userId,
  };
  const { error } = await admin
    .from('employee_capabilities')
    .update(update)
    .eq('id', input.recordId)
    .eq('organization_id', auth.context.orgId);
  if (error) {
    return {
      success: false,
      error: error.code === '23P01' ? 'overlap' : 'update_failed',
    };
  }
  await recordEmployeeQualificationEvent({
    orgId: auth.context.orgId,
    employeeRecordId: current.employee_record_id,
    eventType: 'qualification_corrected',
    payload: {
      employee_capability_id: input.recordId,
      before: {
        valid_from: current.valid_from,
        valid_until: current.valid_until,
        issuer: current.issuer,
        renewal_due_date: current.renewal_due_date,
        confirmation_status: current.confirmation_status,
        evidence_state: current.evidence_state,
        operational_note: current.operational_note,
      },
      after: update,
    },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  return { success: true };
}

export async function setApprenticeWarningEnabled(
  enabled: boolean
): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (auth.context.role !== 'admin') {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: current, error: loadError } = await admin
    .from('organization_qualification_settings')
    .select('organization_id')
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();
  if (loadError) return { success: false, error: 'update_failed' };
  const { error } = current
    ? await admin
        .from('organization_qualification_settings')
        .update({
          apprentice_warning_enabled: enabled,
          updated_by: auth.context.userId,
        })
        .eq('organization_id', auth.context.orgId)
    : await admin.from('organization_qualification_settings').insert({
        organization_id: auth.context.orgId,
        apprentice_warning_enabled: enabled,
        created_by: auth.context.userId,
        updated_by: auth.context.userId,
      });
  if (error) return { success: false, error: 'update_failed' };
  await recordQualificationEvent({
    orgId: auth.context.orgId,
    eventType: 'apprentice_warning_changed',
    payload: { enabled },
    actorId: auth.context.userId,
  });
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  return { success: true };
}

export async function setJobCapabilityRequirements(input: {
  jobId: string;
  requirements: Array<{
    capabilityId: string;
    requireConfirmation: boolean;
  }>;
}): Promise<{ success: boolean; error?: string }> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: job } = await admin
    .from('jobs')
    .select('id')
    .eq('id', input.jobId)
    .eq('organization_id', auth.context.orgId)
    .maybeSingle();
  if (!job) return { success: false, error: 'job_not_found' };
  const normalized = [
    ...new Map(
      input.requirements.map((requirement) => [
        requirement.capabilityId,
        requirement,
      ])
    ).values(),
  ];
  if (normalized.length > 100) {
    return { success: false, error: 'invalid_input' };
  }
  const { error } = await admin.rpc('replace_job_capability_requirements', {
    p_organization_id: auth.context.orgId,
    p_job_id: input.jobId,
    p_capability_ids: normalized.map((requirement) => requirement.capabilityId),
    p_require_confirmations: normalized.map(
      (requirement) => requirement.requireConfirmation
    ),
    p_actor_id: auth.context.userId,
  });
  if (error) {
    console.error('Failed to replace job capability requirements:', error);
    return { success: false, error: 'update_failed' };
  }
  updateTag(CACHE_TAGS.qualifications(auth.context.orgId));
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  return { success: true };
}

export async function getJobQualificationDetail(
  jobId: string
): Promise<
  | { success: true; data: JobQualificationDetail }
  | { success: false; error: string }
> {
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
  if (jobError || !job) return { success: false, error: 'job_not_found' };
  const [definitionsResult, requirementsResult, assignmentsResult, latestResult] =
    await Promise.all([
      admin
        .from('organization_capabilities')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .is('retired_at', null)
        .order('name', { ascending: true })
        .limit(500),
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
    definitionsResult.error ??
    requirementsResult.error ??
    assignmentsResult.error ??
    latestResult.error;
  if (error) {
    console.error('Failed to load job qualification detail:', error);
    return { success: false, error: 'load_failed' };
  }
  const evaluationResult = await loadAssignmentEvaluation({
    admin,
    orgId: auth.context.orgId,
    jobId,
    selectedUserIds: (assignmentsResult.data ?? []).map((row) => row.user_id),
  });
  if (!evaluationResult.success) return evaluationResult;
  const definitions = (definitionsResult.data ?? []).map(
    toCapabilityDefinition
  );
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition])
  );
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

export async function expandTeamForAssignment(input: {
  teamId: string;
  assessedForDate?: string | null;
}): Promise<
  | {
      success: true;
      userIds: string[];
      skippedNames: string[];
      teamSourceId: string;
    }
  | { success: false; error: string }
> {
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
  const { data: team } = await admin
    .from('teams')
    .select('id')
    .eq('id', input.teamId)
    .eq('organization_id', auth.context.orgId)
    .is('dissolved_at', null)
    .maybeSingle();
  if (!team) return { success: false, error: 'team_not_found' };
  const { data: memberships, error } = await admin
    .from('team_memberships')
    .select('employee_record_id')
    .eq('organization_id', auth.context.orgId)
    .eq('team_id', input.teamId)
    .lte('valid_from', date)
    .or(`valid_until.gte.${date},valid_until.is.null`)
    .limit(501);
  if (error) return { success: false, error: 'load_failed' };
  if ((memberships?.length ?? 0) > 500) {
    return { success: false, error: 'load_failed' };
  }
  const recordIds = (memberships ?? []).map((row) => row.employee_record_id);
  const { data: records, error: recordsError } =
    recordIds.length > 0
      ? await admin
          .from('employee_records')
          .select('id, user_id, first_name, last_name')
          .eq('organization_id', auth.context.orgId)
          .in('id', recordIds)
          .order('id', { ascending: true })
          .limit(501)
      : { data: [], error: null };
  if (recordsError) return { success: false, error: 'load_failed' };
  if ((records?.length ?? 0) > 500) {
    return { success: false, error: 'load_failed' };
  }
  const linkedUserIds = (records ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => Boolean(id));
  const { data: memberRows, error: membersError } =
    linkedUserIds.length > 0
      ? await admin
          .from('organization_members')
          .select('user_id')
          .eq('organization_id', auth.context.orgId)
          .in('user_id', linkedUserIds)
          .order('user_id', { ascending: true })
          .limit(501)
      : { data: [], error: null };
  if (membersError) return { success: false, error: 'load_failed' };
  if ((memberRows?.length ?? 0) > 500) {
    return { success: false, error: 'load_failed' };
  }
  const activeMemberIds = new Set((memberRows ?? []).map((row) => row.user_id));
  return {
    success: true,
    userIds: (records ?? [])
      .map((row) => row.user_id)
      .filter(
        (id): id is string => Boolean(id && activeMemberIds.has(id))
      ),
    skippedNames: (records ?? [])
      .filter((row) => !row.user_id || !activeMemberIds.has(row.user_id))
      .map(
        (row) =>
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Unbenannt'
      ),
    teamSourceId: input.teamId,
  };
}

export async function getAssignmentTeamOptions(): Promise<
  | { success: true; teams: Array<{ id: string; name: string }> }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const { data, error } = await createSupabaseAdminClient()
    .from('teams')
    .select('id, name')
    .eq('organization_id', auth.context.orgId)
    .is('dissolved_at', null)
    .order('name', { ascending: true })
    .limit(101);
  if (error) return { success: false, error: 'load_failed' };
  if ((data?.length ?? 0) > 100) {
    return { success: false, error: 'load_failed' };
  }
  return { success: true, teams: data ?? [] };
}
