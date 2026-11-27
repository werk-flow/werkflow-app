import type { OrgRole } from '@/lib/roles';
import type {
  OrganizationResponsibility,
  ResponsibilityAssignmentSource,
  ResponsibilityConfigurationMode,
} from './types';
import { ORGANIZATION_RESPONSIBILITIES } from './types';

export type ResponsibilityMember = {
  employeeRecordId: string;
  userId: string;
  role: OrgRole;
  active: boolean;
  /** An exit date is set, past or planned. */
  hasExitDate: boolean;
  /** Operational personnel access now; a suspended, ended or prestart holder delegates nothing. */
  hasEffectiveAccess: boolean;
};

export type ResponsibilityAssignment = {
  id: string;
  configurationId: string;
  employeeRecordId: string;
  source: ResponsibilityAssignmentSource;
  roleSnapshot: OrgRole | null;
};

export type ResponsibilityConfiguration = {
  id: string;
  responsibility: OrganizationResponsibility;
  mode: ResponsibilityConfigurationMode;
  effectiveFrom: string;
  createdAt: string;
  assignments: ResponsibilityAssignment[];
};

export type ResponsibilityDelegation = {
  id: string;
  responsibility: OrganizationResponsibility;
  delegatorEmployeeRecordId: string;
  substituteEmployeeRecordId: string;
  validFrom: string;
  validUntil: string;
  revokedFrom: string | null;
  /** The Berlin date the revocation was written; null while the window is not revoked. */
  revokedOn: string | null;
};

type RoleDefaultResponsibilitySource = {
  kind: 'role_default';
  configurationId: string | null;
  role: Extract<OrgRole, 'admin' | 'buero'>;
};

type DirectResponsibilitySource = {
  kind: 'direct_assignment';
  configurationId: string;
  assignmentId: string;
};

type DelegatedResponsibilitySource = {
  kind: 'delegation';
  configurationId: string | null;
  delegationId: string;
  delegatedFromEmployeeRecordId: string;
  validFrom: string;
  validUntil: string;
  inheritedSource: RoleDefaultResponsibilitySource | DirectResponsibilitySource;
};

type EffectiveResponsibilitySource =
  | RoleDefaultResponsibilitySource
  | DirectResponsibilitySource
  | DelegatedResponsibilitySource;

export type EffectiveResponsibilityHolder = {
  employeeRecordId: string;
  userId: string;
  /**
   * Effective access now and no exit date set, past or planned: the only
   * co-holder the database's last-holder checks count.
   */
  isLastingHolder: boolean;
  source: EffectiveResponsibilitySource;
};

export type EffectiveResponsibility = {
  responsibility: OrganizationResponsibility;
  configurationId: string | null;
  mode: ResponsibilityConfigurationMode;
  holders: EffectiveResponsibilityHolder[];
};

type ResolveEffectiveResponsibilityInput = {
  responsibility: OrganizationResponsibility;
  actionTime: string;
  businessDate: string;
  members: ResponsibilityMember[];
  configurations: ResponsibilityConfiguration[];
  delegations: ResponsibilityDelegation[];
};

function selectEffectiveConfiguration(
  configurations: ResponsibilityConfiguration[],
  responsibility: OrganizationResponsibility,
  actionTime: string,
): ResponsibilityConfiguration | null {
  return (
    configurations
      .filter(
        (configuration) =>
          configuration.responsibility === responsibility && configuration.effectiveFrom <= actionTime,
      )
      .toSorted((left, right) => {
        const effectiveComparison = right.effectiveFrom.localeCompare(left.effectiveFrom);
        if (effectiveComparison !== 0) return effectiveComparison;
        const createdComparison = right.createdAt.localeCompare(left.createdAt);
        if (createdComparison !== 0) return createdComparison;
        return right.id.localeCompare(left.id);
      })[0] ?? null
  );
}

function isDelegationEffective(delegation: ResponsibilityDelegation, businessDate: string): boolean {
  return (
    delegation.validFrom <= businessDate &&
    delegation.validUntil >= businessDate &&
    (delegation.revokedFrom === null || delegation.revokedFrom > businessDate)
  );
}

/** The newest delegation wins; then the one that ends first; then the id, so input order never matters. */
function compareDelegationPrecedence(
  left: ResponsibilityDelegation,
  right: ResponsibilityDelegation,
): number {
  const startComparison = right.validFrom.localeCompare(left.validFrom);
  if (startComparison !== 0) return startComparison;
  const endComparison = left.validUntil.localeCompare(right.validUntil);
  if (endComparison !== 0) return endComparison;
  return left.id.localeCompare(right.id);
}

/**
 * The rule of the last-holder checks in
 * `app_private.protect_last_selected_responsibility_holder` and
 * `public.set_personnel_employment_transition`: no exit date and
 * `app_private.p1_24_has_effective_access`.
 */
function isLastingHolder(member: ResponsibilityMember): boolean {
  return !member.hasExitDate && member.hasEffectiveAccess;
}

/** The holders the configuration names, or every active Admin and Büro member when none is effective. */
function resolveBaseHolders(
  configuration: ResponsibilityConfiguration | null,
  members: ResponsibilityMember[],
  activeMemberByRecordId: Map<string, ResponsibilityMember>,
): EffectiveResponsibilityHolder[] {
  return configuration
    ? configuration.assignments.flatMap<EffectiveResponsibilityHolder>((assignment) => {
        const member = activeMemberByRecordId.get(assignment.employeeRecordId);
        if (!member) return [];

        if (
          assignment.source === 'role_default' &&
          (assignment.roleSnapshot === 'admin' || assignment.roleSnapshot === 'buero')
        ) {
          return [
            {
              employeeRecordId: member.employeeRecordId,
              userId: member.userId,
              isLastingHolder: isLastingHolder(member),
              source: {
                kind: 'role_default' as const,
                configurationId: configuration.id,
                role: assignment.roleSnapshot,
              },
            },
          ];
        }

        if (assignment.source === 'direct') {
          return [
            {
              employeeRecordId: member.employeeRecordId,
              userId: member.userId,
              isLastingHolder: isLastingHolder(member),
              source: {
                kind: 'direct_assignment' as const,
                configurationId: configuration.id,
                assignmentId: assignment.id,
              },
            },
          ];
        }

        return [];
      })
    : members.flatMap((member) => {
        if (!member.active || (member.role !== 'admin' && member.role !== 'buero')) {
          return [];
        }

        return [
          {
            employeeRecordId: member.employeeRecordId,
            userId: member.userId,
            isLastingHolder: isLastingHolder(member),
            source: {
              kind: 'role_default' as const,
              configurationId: null,
              role: member.role,
            },
          },
        ];
      });
}

/**
 * Adds the substitute of each effective delegation, in precedence order. A
 * substitute who already holds the responsibility keeps their own source, and
 * a delegated holding is never passed on.
 */
function addDelegatedHolders(
  holders: Map<string, EffectiveResponsibilityHolder>,
  effectiveDelegations: ResponsibilityDelegation[],
  activeMemberByRecordId: Map<string, ResponsibilityMember>,
  configurationId: string | null,
): void {
  for (const delegation of effectiveDelegations) {
    if (holders.has(delegation.substituteEmployeeRecordId)) {
      continue;
    }

    const delegator = holders.get(delegation.delegatorEmployeeRecordId);
    const substitute = activeMemberByRecordId.get(delegation.substituteEmployeeRecordId);
    if (!delegator || !substitute || delegator.source.kind === 'delegation') {
      continue;
    }

    holders.set(substitute.employeeRecordId, {
      employeeRecordId: substitute.employeeRecordId,
      userId: substitute.userId,
      isLastingHolder: isLastingHolder(substitute),
      source: {
        kind: 'delegation',
        configurationId,
        delegationId: delegation.id,
        delegatedFromEmployeeRecordId: delegator.employeeRecordId,
        validFrom: delegation.validFrom,
        validUntil: delegation.validUntil,
        inheritedSource: delegator.source,
      },
    });
  }
}

export function resolveEffectiveResponsibility({
  responsibility,
  actionTime,
  businessDate,
  members,
  configurations,
  delegations,
}: ResolveEffectiveResponsibilityInput): EffectiveResponsibility {
  const activeMemberByRecordId = new Map(
    members.filter((member) => member.active).map((member) => [member.employeeRecordId, member]),
  );
  const configuration = selectEffectiveConfiguration(configurations, responsibility, actionTime);

  const baseHolders = resolveBaseHolders(configuration, members, activeMemberByRecordId);
  const holders = new Map(baseHolders.map((holder) => [holder.employeeRecordId, holder]));

  const effectiveDelegations = delegations
    .filter(
      (delegation) =>
        delegation.responsibility === responsibility &&
        isDelegationEffective(delegation, businessDate) &&
        activeMemberByRecordId.get(delegation.delegatorEmployeeRecordId)?.hasEffectiveAccess === true,
    )
    .toSorted(compareDelegationPrecedence);
  addDelegatedHolders(holders, effectiveDelegations, activeMemberByRecordId, configuration?.id ?? null);

  return {
    responsibility,
    configurationId: configuration?.id ?? null,
    mode: configuration?.mode ?? 'role_default',
    holders: Array.from(holders.values()),
  };
}

/**
 * The role an approval scope sees for a personnel record: the membership role;
 * a person without a login holds no membership and counts as an employee; a
 * login without a current membership has no known role, so only an Admin
 * source or a direct assignment reaches it. The database applies the same rule
 * in `app_private.can_p1_23_approve_employee`.
 */
export function approvalTargetRole(userId: string | null, membershipRole: OrgRole | null): OrgRole | null {
  return userId === null ? 'employee' : membershipRole;
}

/** A target without a login has no user id; a target without a known role is out of a Büro holder's reach. */
export function canHolderApproveTarget(
  holder: EffectiveResponsibilityHolder,
  targetUserId: string | null,
  targetRole: OrgRole | null,
): boolean {
  if (holder.userId === targetUserId) return false;

  const source = holder.source.kind === 'delegation' ? holder.source.inheritedSource : holder.source;

  if (source.kind === 'direct_assignment') return true;
  if (source.role === 'admin') return true;
  return targetRole === 'employee';
}

/**
 * The selected groups the person holds where no other base holder is lasting
 * (`isLastingHolder`): the database refuses their removal or exit with
 * `last_responsibility_holder`.
 */
export function getResponsibilitiesStrandedByEmployeeRemoval(
  effective: Partial<Record<OrganizationResponsibility, EffectiveResponsibility>>,
  employeeRecordId: string,
): OrganizationResponsibility[] {
  return ORGANIZATION_RESPONSIBILITIES.filter((responsibility) => {
    const resolved = effective[responsibility];
    if (!resolved || resolved.mode !== 'selected') return false;
    const baseHolders = resolved.holders.filter((holder) => holder.source.kind !== 'delegation');
    return (
      baseHolders.some((holder) => holder.employeeRecordId === employeeRecordId) &&
      !baseHolders.some((holder) => holder.employeeRecordId !== employeeRecordId && holder.isLastingHolder)
    );
  });
}

/** The next access step that can change a selected group's removal guard. */
export function getNextSelectedHolderAccessChangeAt(
  effective: Partial<Record<OrganizationResponsibility, EffectiveResponsibility>>,
  accessSchedulesByRecordId: ReadonlyMap<string, string | null>,
  now: number,
): string | null {
  let next: string | null = null;
  for (const responsibility of Object.values(effective)) {
    if (responsibility.mode !== 'selected') continue;
    for (const holder of responsibility.holders) {
      if (holder.source.kind === 'delegation') continue;
      const scheduledFor = accessSchedulesByRecordId.get(holder.employeeRecordId);
      if (!scheduledFor || Date.parse(scheduledFor) <= now) continue;
      if (next === null || Date.parse(scheduledFor) < Date.parse(next)) next = scheduledFor;
    }
  }
  return next;
}
