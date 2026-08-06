import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import {
  canHolderApproveTarget,
  getResponsibilitiesStrandedByEmployeeRemoval,
  resolveEffectiveResponsibility,
  type EffectiveResponsibility,
  type EffectiveResponsibilityHolder,
  type ResponsibilityConfiguration,
  type ResponsibilityDelegation,
  type ResponsibilityMember,
} from './resolution';
import type {
  OrgRole,
  OrganizationResponsibility,
  ResponsibilityPerson,
} from './types';

export type ResponsibilityRuntimeState = {
  members: ResponsibilityMember[];
  people: ResponsibilityPerson[];
  configurations: ResponsibilityConfiguration[];
  delegations: ResponsibilityDelegation[];
};

export type ResponsibilitySettingsData = {
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  currentEmployeeRecordId: string | null;
  isOwner: boolean;
  businessDate: string;
  people: ResponsibilityPerson[];
  configurations: ResponsibilityConfiguration[];
  delegations: ResponsibilityDelegation[];
  effective: Record<OrganizationResponsibility, EffectiveResponsibility>;
};

export async function loadResponsibilityRuntimeState(
  organizationId: string
): Promise<ResponsibilityRuntimeState | null> {
  const admin = createSupabaseAdminClient();
  const businessDate = getBusinessTodayIso();
  const [
    configurationsResult,
    assignmentsResult,
    delegationsResult,
    employeeRecordsResult,
    membershipsResult,
  ] = await Promise.all([
    admin
      .from('organization_responsibility_configurations')
      .select('*')
      .eq('organization_id', organizationId),
    admin
      .from('organization_responsibility_assignments')
      .select('*')
      .eq('organization_id', organizationId),
    admin
      .from('organization_responsibility_delegations')
      .select('*')
      .eq('organization_id', organizationId),
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name, exit_date')
      .eq('organization_id', organizationId),
    admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId),
  ]);

  const loadError =
    configurationsResult.error ??
    assignmentsResult.error ??
    delegationsResult.error ??
    employeeRecordsResult.error ??
    membershipsResult.error;
  if (loadError) {
    console.error('Failed to load responsibility state:', loadError);
    return null;
  }

  const membershipByUserId = new Map(
    (membershipsResult.data ?? []).map((membership) => [
      membership.user_id,
      membership.role as OrgRole,
    ])
  );
  const userIds = Array.from(membershipByUserId.keys());
  const profilesResult =
    userIds.length > 0
      ? await admin
          .from('profiles')
          .select('id, first_name, last_name, email')
          .in('id', userIds)
      : { data: [], error: null };

  if (profilesResult.error) {
    console.error('Failed to load responsibility holder profiles:', profilesResult.error);
    return null;
  }

  const profileByUserId = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile])
  );
  const members: ResponsibilityMember[] = [];
  const people: ResponsibilityPerson[] = [];

  for (const record of employeeRecordsResult.data ?? []) {
    if (!record.user_id) continue;
    const role = membershipByUserId.get(record.user_id);
    if (!role) continue;
    const profile = profileByUserId.get(record.user_id);
    const isActive =
      record.exit_date === null || record.exit_date > businessDate;

    members.push({
      employeeRecordId: record.id,
      userId: record.user_id,
      role,
      active: isActive,
    });
    if (isActive) {
      people.push({
        employeeRecordId: record.id,
        userId: record.user_id,
        firstName: profile?.first_name ?? record.first_name,
        lastName: profile?.last_name ?? record.last_name,
        email: profile?.email ?? null,
        role,
      });
    }
  }

  const assignmentsByConfigurationId = new Map<
    string,
    ResponsibilityConfiguration['assignments']
  >();
  for (const assignment of assignmentsResult.data ?? []) {
    const assignments =
      assignmentsByConfigurationId.get(assignment.configuration_id) ?? [];
    assignments.push({
      id: assignment.id,
      configurationId: assignment.configuration_id,
      employeeRecordId: assignment.employee_record_id,
      source: assignment.source,
      roleSnapshot: assignment.role_snapshot,
    });
    assignmentsByConfigurationId.set(assignment.configuration_id, assignments);
  }

  return {
    members,
    people: people.toSorted((left, right) => {
      const leftName = `${left.lastName ?? ''} ${left.firstName ?? ''}`;
      const rightName = `${right.lastName ?? ''} ${right.firstName ?? ''}`;
      return leftName.localeCompare(rightName, 'de');
    }),
    configurations: (configurationsResult.data ?? []).map((configuration) => ({
      id: configuration.id,
      responsibility: configuration.responsibility,
      mode: configuration.mode,
      effectiveFrom: configuration.effective_from,
      createdAt: configuration.created_at,
      assignments:
        assignmentsByConfigurationId.get(configuration.id) ?? [],
    })),
    delegations: (delegationsResult.data ?? []).map((delegation) => ({
      id: delegation.id,
      responsibility: delegation.responsibility,
      delegatorEmployeeRecordId: delegation.delegator_employee_record_id,
      substituteEmployeeRecordId: delegation.substitute_employee_record_id,
      validFrom: delegation.valid_from,
      validUntil: delegation.valid_until,
      revokedFrom: delegation.revoked_from,
    })),
  };
}

export async function getResponsibilitySettingsData(): Promise<
  | { success: true; data: ResponsibilitySettingsData }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  const { orgId, userId, role } = auth.context;
  const admin = createSupabaseAdminClient();
  const [state, organizationResult] = await Promise.all([
    loadResponsibilityRuntimeState(orgId),
    admin.from('organizations').select('admin_id').eq('id', orgId).single(),
  ]);
  if (!state || organizationResult.error || !organizationResult.data) {
    return { success: false, error: 'load_failed' };
  }

  const businessDate = getBusinessTodayIso();
  const actionTime = new Date().toISOString();
  const currentEmployeeRecordId =
    state.members.find((member) => member.userId === userId)?.employeeRecordId ??
    null;
  const isManager = role === 'admin' || role === 'buero';
  const visibleDelegations = isManager
    ? state.delegations
    : state.delegations.filter(
        (delegation) =>
          delegation.delegatorEmployeeRecordId === currentEmployeeRecordId ||
          delegation.substituteEmployeeRecordId === currentEmployeeRecordId
      );
  const visiblePersonIds = new Set<string>([
    ...(currentEmployeeRecordId ? [currentEmployeeRecordId] : []),
    ...visibleDelegations.flatMap((delegation) => [
      delegation.delegatorEmployeeRecordId,
      delegation.substituteEmployeeRecordId,
    ]),
  ]);
  const timeApproval = resolveEffectiveResponsibility({
    responsibility: 'time_approval',
    actionTime,
    businessDate,
    ...state,
  });
  const leaveApproval = resolveEffectiveResponsibility({
    responsibility: 'leave_approval',
    actionTime,
    businessDate,
    ...state,
  });

  const scopeEffective = (
    effectiveResponsibility: EffectiveResponsibility
  ): EffectiveResponsibility =>
    isManager
      ? effectiveResponsibility
      : {
          ...effectiveResponsibility,
          holders: effectiveResponsibility.holders.filter(
            (holder) => holder.employeeRecordId === currentEmployeeRecordId
          ),
        };

  return {
    success: true,
    data: {
      organizationId: orgId,
      currentUserId: userId,
      currentUserRole: role,
      currentEmployeeRecordId,
      isOwner: organizationResult.data.admin_id === userId,
      businessDate,
      people: isManager
        ? state.people
        : state.people.filter((person) =>
            visiblePersonIds.has(person.employeeRecordId)
          ),
      configurations: isManager ? state.configurations : [],
      delegations: visibleDelegations,
      effective: {
        time_approval: scopeEffective(timeApproval),
        leave_approval: scopeEffective(leaveApproval),
      },
    },
  };
}

export async function authorizeResponsibilityForTarget(input: {
  organizationId: string;
  responsibility: OrganizationResponsibility;
  actorUserId: string;
  targetUserId: string;
  targetRole: OrgRole;
}): Promise<
  | {
      success: true;
      holder: EffectiveResponsibilityHolder;
      effective: EffectiveResponsibility;
    }
  | { success: false; error: string }
> {
  const state = await loadResponsibilityRuntimeState(input.organizationId);
  if (!state) return { success: false, error: 'responsibility_load_failed' };

  const effective = resolveEffectiveResponsibility({
    responsibility: input.responsibility,
    actionTime: new Date().toISOString(),
    businessDate: getBusinessTodayIso(),
    ...state,
  });
  const holder = effective.holders.find(
    (candidate) => candidate.userId === input.actorUserId
  );

  if (
    !holder ||
    !canHolderApproveTarget(holder, input.targetUserId, input.targetRole)
  ) {
    return {
      success: false,
      error:
        input.actorUserId === input.targetUserId
          ? 'self_approval_not_allowed'
          : 'not_responsible',
    };
  }

  return { success: true, holder, effective };
}

export async function getEffectiveResponsibilityHolderForActor(input: {
  organizationId: string;
  responsibility: OrganizationResponsibility;
  actorUserId: string;
}): Promise<EffectiveResponsibilityHolder | null> {
  const state = await loadResponsibilityRuntimeState(input.organizationId);
  if (!state) return null;

  const effective = resolveEffectiveResponsibility({
    responsibility: input.responsibility,
    actionTime: new Date().toISOString(),
    businessDate: getBusinessTodayIso(),
    ...state,
  });
  return (
    effective.holders.find((holder) => holder.userId === input.actorUserId) ??
    null
  );
}

export async function getResponsibilitiesStrandedByMemberRemoval(input: {
  organizationId: string;
  userId: string;
}): Promise<OrganizationResponsibility[]> {
  const state = await loadResponsibilityRuntimeState(input.organizationId);
  if (!state) return [];

  const employeeRecordId = state.members.find(
    (member) => member.userId === input.userId
  )?.employeeRecordId;
  if (!employeeRecordId) return [];

  const actionTime = new Date().toISOString();
  const businessDate = getBusinessTodayIso();
  const effective = {
    time_approval: resolveEffectiveResponsibility({
      responsibility: 'time_approval',
      actionTime,
      businessDate,
      ...state,
    }),
    leave_approval: resolveEffectiveResponsibility({
      responsibility: 'leave_approval',
      actionTime,
      businessDate,
      ...state,
    }),
  };
  return getResponsibilitiesStrandedByEmployeeRemoval(
    effective,
    employeeRecordId
  );
}
