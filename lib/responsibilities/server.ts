import type { ActionFailure, ActionResult } from '@/lib/action-result';
import 'server-only';

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { logReadFailure, memoizeRequestRead, logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { getMembershipAccessMode } from '@/lib/personnel/lifecycle';
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
import type { OrgRole } from '@/lib/roles';
import type { OrganizationResponsibility, ResponsibilityPerson } from './types';

export type ResponsibilityRuntimeState = {
  members: ResponsibilityMember[];
  people: ResponsibilityPerson[];
  configurations: ResponsibilityConfiguration[];
  delegations: ResponsibilityDelegation[];
};

/**
 * Action time for effective-responsibility resolution. Configurations are
 * stamped with the database clock (`clock_timestamp()` in
 * `apply_responsibility_configuration`); when the app server's clock trails
 * the database, a just-applied configuration would otherwise not be effective
 * yet — leaving a freshly revoked holder authorized for the skew window.
 * Configurations are never
 * future-dated, so flooring the local time to the newest configuration
 * timestamp is safe and keeps all config-to-config ordering intact.
 */
function getSkewGuardedActionTime(configurations: ResponsibilityConfiguration[]): string {
  const localNow = new Date().toISOString();
  let newest: string | null = null;
  for (const configuration of configurations) {
    if (newest === null || Date.parse(configuration.effectiveFrom) > Date.parse(newest)) {
      newest = configuration.effectiveFrom;
    }
  }
  if (newest !== null && Date.parse(newest) > Date.parse(localNow)) {
    return newest;
  }
  return localNow;
}

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

export const loadResponsibilityRuntimeState = memoizeRequestRead(
  async function loadResponsibilityRuntimeState(
    organizationId: string,
  ): Promise<ResponsibilityRuntimeState | null> {
    const admin = createSupabaseAdminClient();
    const businessDate = getBusinessTodayIso();
    const now = Date.now();
    const rows = await readResponsibilityStateRows(admin, organizationId, businessDate);
    if (!rows) return null;

    const membershipByUserId = new Map(
      rows.memberships.map((membership) => [membership.user_id, membership.role]),
    );
    const userIds = Array.from(membershipByUserId.keys());
    const profilesResult = await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
    );

    if (profilesResult.error) {
      logReadFailure('Failed to load responsibility holder profiles:', profilesResult.error);
      return null;
    }

    const profileByUserId = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
    const { members, people } = toResponsibilityMembers(
      rows.employeeRecords,
      membershipByUserId,
      profileByUserId,
      businessDate,
      now,
    );

    return {
      members,
      people: people.toSorted((left, right) => {
        const leftName = `${left.lastName ?? ''} ${left.firstName ?? ''}`;
        const rightName = `${right.lastName ?? ''} ${right.firstName ?? ''}`;
        return leftName.localeCompare(rightName, 'de');
      }),
      configurations: toResponsibilityConfigurations(rows.configurations, rows.assignments),
      delegations: rows.delegations.map(toResponsibilityDelegation),
    };
  },
  { outsideRequest: 'fresh' },
);

/** The organization's responsibility rows, complete; null when a read failed. */
async function readResponsibilityStateRows(admin: AdminClient, organizationId: string, businessDate: string) {
  const [
    configurationsResult,
    assignmentsResult,
    delegationsResult,
    employeeRecordsResult,
    membershipsResult,
  ] = await Promise.all([
    // Authorization state: a page truncated at 1,000 rows would silently drop holders.
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_responsibility_configurations')
          .select('*')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_responsibility_assignments')
          .select('*')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_responsibility_delegations')
          .select('*')
          .eq('organization_id', organizationId)
          // An ended delegation is never effective (isDelegationEffective); its history is a settings read.
          .gte('valid_until', businessDate)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readEmployeeRecordsWithAccess(admin, organizationId),
    readCompleteRows(
      (from, to) =>
        admin
          .from('organization_members')
          .select('user_id, role')
          .eq('organization_id', organizationId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);

  const loadError =
    configurationsResult.error ??
    assignmentsResult.error ??
    delegationsResult.error ??
    employeeRecordsResult.error ??
    membershipsResult.error;
  if (loadError) {
    logReadFailure('Failed to load responsibility state:', loadError);
    return null;
  }
  return {
    configurations: configurationsResult.data ?? [],
    assignments: assignmentsResult.data ?? [],
    delegations: delegationsResult.data ?? [],
    employeeRecords: employeeRecordsResult.data ?? [],
    memberships: membershipsResult.data ?? [],
  };
}

type ResponsibilityStateRows = NonNullable<Awaited<ReturnType<typeof readResponsibilityStateRows>>>;

/** Every member with a login and a membership; the active ones are also the people the settings list. */
function toResponsibilityMembers(
  employeeRecords: ResponsibilityStateRows['employeeRecords'],
  membershipByUserId: Map<string, OrgRole>,
  profileByUserId: Map<string, Pick<Tables<'profiles'>, 'first_name' | 'last_name' | 'email'>>,
  businessDate: string,
  now: number,
): { members: ResponsibilityMember[]; people: ResponsibilityPerson[] } {
  const members: ResponsibilityMember[] = [];
  const people: ResponsibilityPerson[] = [];

  for (const record of employeeRecords) {
    if (!record.user_id) continue;
    const role = membershipByUserId.get(record.user_id);
    if (!role) continue;
    const profile = profileByUserId.get(record.user_id);
    const isActive = record.exit_date === null || record.exit_date > businessDate;

    members.push({
      employeeRecordId: record.id,
      userId: record.user_id,
      role,
      active: isActive,
      hasEffectiveAccess: hasOperationalAccess(record, now),
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
  return { members, people };
}

function toResponsibilityConfigurations(
  configurations: ResponsibilityStateRows['configurations'],
  assignmentRows: ResponsibilityStateRows['assignments'],
): ResponsibilityConfiguration[] {
  const assignmentsByConfigurationId = new Map<string, ResponsibilityConfiguration['assignments']>();
  for (const assignment of assignmentRows) {
    const assignments = assignmentsByConfigurationId.get(assignment.configuration_id) ?? [];
    assignments.push({
      id: assignment.id,
      configurationId: assignment.configuration_id,
      employeeRecordId: assignment.employee_record_id,
      source: assignment.source,
      roleSnapshot: assignment.role_snapshot,
    });
    assignmentsByConfigurationId.set(assignment.configuration_id, assignments);
  }

  return configurations.map((configuration) => ({
    id: configuration.id,
    responsibility: configuration.responsibility,
    mode: configuration.mode,
    effectiveFrom: configuration.effective_from,
    createdAt: configuration.created_at,
    assignments: assignmentsByConfigurationId.get(configuration.id) ?? [],
  }));
}

/** One value per responsibility; a Record over the enum, so a new responsibility fails to compile here. */
function mapResponsibilities<Value>(
  valueOf: (responsibility: OrganizationResponsibility) => Value,
): Record<OrganizationResponsibility, Value> {
  return {
    time_approval: valueOf('time_approval'),
    leave_approval: valueOf('leave_approval'),
    work_artifact_approval: valueOf('work_artifact_approval'),
    work_handover_review: valueOf('work_handover_review'),
  };
}

/** Employee records with their access lifecycle and, at most, one open access blocker. */
function readEmployeeRecordsWithAccess(admin: AdminClient, organizationId: string) {
  return readCompleteRows(
    (from, to) =>
      admin
        .from('employee_records')
        .select(
          `id, user_id, first_name, last_name, exit_date,
          personnel_access_lifecycles!personnel_access_lifecycles_employee_org_fkey (state, scheduled_state, scheduled_for),
          personnel_onboarding_requirements!personnel_onboarding_requirements_employee_org_fkey (id)`,
        )
        .eq('organization_id', organizationId)
        // Only the existence of an open access blocker matters (getMembershipAccessMode).
        .eq('personnel_onboarding_requirements.blocks_access', true)
        .not('personnel_onboarding_requirements.state', 'in', '(fulfilled,waived,cancelled)')
        .limit(1, { referencedTable: 'personnel_onboarding_requirements' })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
}

type EmployeeAccessRow = {
  personnel_access_lifecycles: Pick<
    Tables<'personnel_access_lifecycles'>,
    'state' | 'scheduled_state' | 'scheduled_for'
  >[];
  personnel_onboarding_requirements: Pick<Tables<'personnel_onboarding_requirements'>, 'id'>[];
};

/** Operational access now, the rule of app_private.p1_24_has_effective_access. */
function hasOperationalAccess(record: EmployeeAccessRow, now: number): boolean {
  const lifecycle = record.personnel_access_lifecycles[0];
  const accessLifecycle = lifecycle
    ? {
        state: lifecycle.state,
        scheduledState: lifecycle.scheduled_state,
        scheduledFor: lifecycle.scheduled_for,
      }
    : null;
  const hasAccessBlocker = record.personnel_onboarding_requirements.length > 0;
  return getMembershipAccessMode({ hasAccessBlocker, accessLifecycle }, now) === 'operational';
}

function toResponsibilityDelegation(
  delegation: Tables<'organization_responsibility_delegations'>,
): ResponsibilityDelegation {
  return {
    id: delegation.id,
    responsibility: delegation.responsibility,
    delegatorEmployeeRecordId: delegation.delegator_employee_record_id,
    substituteEmployeeRecordId: delegation.substitute_employee_record_id,
    validFrom: delegation.valid_from,
    validUntil: delegation.valid_until,
    revokedFrom: delegation.revoked_from,
  };
}

/**
 * Every delegation of the organization, ended ones included: the settings
 * page lists the history. The runtime state holds only the delegations that
 * have not ended, the only ones that can be effective.
 */
async function readDelegationHistory(organizationId: string): Promise<ResponsibilityDelegation[] | null> {
  const admin = createSupabaseAdminClient();
  const result = await readCompleteRows(
    (from, to) =>
      admin
        .from('organization_responsibility_delegations')
        .select('*')
        .eq('organization_id', organizationId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (result.error) {
    logReadFailure('Failed to load the delegation history:', result.error);
    return null;
  }
  return result.data.map(toResponsibilityDelegation);
}

export async function getResponsibilitySettingsData(): Promise<
  ActionResult<{ data: ResponsibilitySettingsData }>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  const { orgId, userId, role } = auth.context;
  const admin = createSupabaseAdminClient();
  const [state, delegations, organizationResult] = await Promise.all([
    loadResponsibilityRuntimeState(orgId),
    readDelegationHistory(orgId),
    admin.from('organizations').select('admin_id').eq('id', orgId).single(),
  ]);
  if (!state || !delegations || organizationResult.error || !organizationResult.data) {
    logReadErrors('getResponsibilitySettingsData: read failed', organizationResult.error);
    return { success: false, error: 'load_failed' };
  }

  const businessDate = getBusinessTodayIso();
  const actionTime = getSkewGuardedActionTime(state.configurations);
  const currentEmployeeRecordId =
    state.members.find((member) => member.userId === userId)?.employeeRecordId ?? null;
  const isManager = role === 'admin' || role === 'buero';
  const visibleDelegations = isManager
    ? delegations
    : delegations.filter(
        (delegation) =>
          delegation.delegatorEmployeeRecordId === currentEmployeeRecordId ||
          delegation.substituteEmployeeRecordId === currentEmployeeRecordId,
      );
  const visiblePersonIds = new Set<string>([
    ...(currentEmployeeRecordId ? [currentEmployeeRecordId] : []),
    ...visibleDelegations.flatMap((delegation) => [
      delegation.delegatorEmployeeRecordId,
      delegation.substituteEmployeeRecordId,
    ]),
  ]);
  const effectiveResponsibilities = mapResponsibilities((responsibility) =>
    resolveEffectiveResponsibility({ responsibility, actionTime, businessDate, ...state }),
  );

  const scopeEffective = (effectiveResponsibility: EffectiveResponsibility): EffectiveResponsibility =>
    isManager
      ? effectiveResponsibility
      : {
          ...effectiveResponsibility,
          holders: effectiveResponsibility.holders.filter(
            (holder) => holder.employeeRecordId === currentEmployeeRecordId,
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
        : state.people.filter((person) => visiblePersonIds.has(person.employeeRecordId)),
      configurations: isManager ? state.configurations : [],
      delegations: visibleDelegations,
      effective: mapResponsibilities((responsibility) =>
        scopeEffective(effectiveResponsibilities[responsibility]),
      ),
    },
  };
}

export async function authorizeResponsibilityForTarget(input: {
  organizationId: string;
  responsibility: OrganizationResponsibility;
  actorUserId: string;
  targetUserId: string | null;
  targetRole: OrgRole | null;
}): Promise<
  | {
      success: true;
      holder: EffectiveResponsibilityHolder;
      effective: EffectiveResponsibility;
    }
  | ActionFailure
> {
  const state = await loadResponsibilityRuntimeState(input.organizationId);
  if (!state) return { success: false, error: 'responsibility_load_failed' };

  const effective = resolveEffectiveResponsibility({
    responsibility: input.responsibility,
    actionTime: getSkewGuardedActionTime(state.configurations),
    businessDate: getBusinessTodayIso(),
    ...state,
  });
  const holder = effective.holders.find((candidate) => candidate.userId === input.actorUserId);

  if (!holder || !canHolderApproveTarget(holder, input.targetUserId, input.targetRole)) {
    return {
      success: false,
      error: input.actorUserId === input.targetUserId ? 'self_approval_not_allowed' : 'not_responsible',
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
    actionTime: getSkewGuardedActionTime(state.configurations),
    businessDate: getBusinessTodayIso(),
    ...state,
  });
  return effective.holders.find((holder) => holder.userId === input.actorUserId) ?? null;
}

/** Null when the responsibility state cannot be read: a failed read must block the removal, never pass it. */
export async function getResponsibilitiesStrandedByMemberRemoval(input: {
  organizationId: string;
  userId: string;
}): Promise<OrganizationResponsibility[] | null> {
  const state = await loadResponsibilityRuntimeState(input.organizationId);
  if (!state) return null;

  const employeeRecordId = state.members.find((member) => member.userId === input.userId)?.employeeRecordId;
  if (!employeeRecordId) return [];

  const actionTime = getSkewGuardedActionTime(state.configurations);
  const businessDate = getBusinessTodayIso();
  const effective = mapResponsibilities((responsibility) =>
    resolveEffectiveResponsibility({ responsibility, actionTime, businessDate, ...state }),
  );
  return getResponsibilitiesStrandedByEmployeeRemoval(effective, employeeRecordId);
}
