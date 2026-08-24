import type {
  OrgRole,
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
};

export type RoleDefaultResponsibilitySource = {
  kind: 'role_default';
  configurationId: string | null;
  role: Extract<OrgRole, 'admin' | 'buero'>;
};

export type DirectResponsibilitySource = {
  kind: 'direct_assignment';
  configurationId: string;
  assignmentId: string;
};

export type DelegatedResponsibilitySource = {
  kind: 'delegation';
  configurationId: string | null;
  delegationId: string;
  delegatedFromEmployeeRecordId: string;
  validFrom: string;
  validUntil: string;
  inheritedSource:
    | RoleDefaultResponsibilitySource
    | DirectResponsibilitySource;
};

export type EffectiveResponsibilitySource =
  | RoleDefaultResponsibilitySource
  | DirectResponsibilitySource
  | DelegatedResponsibilitySource;

export type EffectiveResponsibilityHolder = {
  employeeRecordId: string;
  userId: string;
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
  actionTime: string
): ResponsibilityConfiguration | null {
  return (
    configurations
      .filter(
        (configuration) =>
          configuration.responsibility === responsibility &&
          configuration.effectiveFrom <= actionTime
      )
      .toSorted((left, right) => {
        const effectiveComparison = right.effectiveFrom.localeCompare(
          left.effectiveFrom
        );
        if (effectiveComparison !== 0) return effectiveComparison;
        const createdComparison = right.createdAt.localeCompare(left.createdAt);
        if (createdComparison !== 0) return createdComparison;
        return right.id.localeCompare(left.id);
      })[0] ?? null
  );
}

function isDelegationEffective(
  delegation: ResponsibilityDelegation,
  businessDate: string
): boolean {
  return (
    delegation.validFrom <= businessDate &&
    delegation.validUntil >= businessDate &&
    (delegation.revokedFrom === null || delegation.revokedFrom > businessDate)
  );
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
    members
      .filter((member) => member.active)
      .map((member) => [member.employeeRecordId, member])
  );
  const configuration = selectEffectiveConfiguration(
    configurations,
    responsibility,
    actionTime
  );

  const baseHolders: EffectiveResponsibilityHolder[] = configuration
    ? configuration.assignments.flatMap<EffectiveResponsibilityHolder>((assignment) => {
        const member = activeMemberByRecordId.get(assignment.employeeRecordId);
        if (!member) return [];

        if (
          assignment.source === 'role_default' &&
          (assignment.roleSnapshot === 'admin' ||
            assignment.roleSnapshot === 'buero')
        ) {
          return [
            {
              employeeRecordId: member.employeeRecordId,
              userId: member.userId,
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
        if (
          !member.active ||
          (member.role !== 'admin' && member.role !== 'buero')
        ) {
          return [];
        }

        return [
          {
            employeeRecordId: member.employeeRecordId,
            userId: member.userId,
            source: {
              kind: 'role_default' as const,
              configurationId: null,
              role: member.role,
            },
          },
        ];
      });

  const holders = new Map(
    baseHolders.map((holder) => [holder.employeeRecordId, holder])
  );

  const effectiveDelegations = delegations
    .filter(
      (delegation) =>
        delegation.responsibility === responsibility &&
        isDelegationEffective(delegation, businessDate)
    )
    .toSorted((left, right) => {
      const startComparison = right.validFrom.localeCompare(left.validFrom);
      if (startComparison !== 0) return startComparison;
      const endComparison = left.validUntil.localeCompare(right.validUntil);
      if (endComparison !== 0) return endComparison;
      return left.id.localeCompare(right.id);
    });

  for (const delegation of effectiveDelegations) {
    if (
      holders.has(delegation.substituteEmployeeRecordId)
    ) {
      continue;
    }

    const delegator = holders.get(delegation.delegatorEmployeeRecordId);
    const substitute = activeMemberByRecordId.get(
      delegation.substituteEmployeeRecordId
    );
    if (!delegator || !substitute || delegator.source.kind === 'delegation') {
      continue;
    }

    holders.set(substitute.employeeRecordId, {
      employeeRecordId: substitute.employeeRecordId,
      userId: substitute.userId,
      source: {
        kind: 'delegation',
        configurationId: configuration?.id ?? null,
        delegationId: delegation.id,
        delegatedFromEmployeeRecordId: delegator.employeeRecordId,
        validFrom: delegation.validFrom,
        validUntil: delegation.validUntil,
        inheritedSource: delegator.source,
      },
    });
  }

  return {
    responsibility,
    configurationId: configuration?.id ?? null,
    mode: configuration?.mode ?? 'role_default',
    holders: Array.from(holders.values()),
  };
}

export function canHolderApproveTarget(
  holder: EffectiveResponsibilityHolder,
  targetUserId: string,
  targetRole: OrgRole
): boolean {
  if (holder.userId === targetUserId) return false;

  const source =
    holder.source.kind === 'delegation'
      ? holder.source.inheritedSource
      : holder.source;

  if (source.kind === 'direct_assignment') return true;
  if (source.role === 'admin') return true;
  return targetRole === 'employee';
}

export function getResponsibilitiesStrandedByEmployeeRemoval(
  effective: Partial<Record<OrganizationResponsibility, EffectiveResponsibility>>,
  employeeRecordId: string
): OrganizationResponsibility[] {
  return ORGANIZATION_RESPONSIBILITIES.filter(
    (responsibility) => {
      const resolved = effective[responsibility];
      if (!resolved) return false;
      const baseHolders = resolved.holders.filter(
        (holder) => holder.source.kind !== 'delegation'
      );
      return (
        resolved.mode === 'selected' &&
        baseHolders.length === 1 &&
        baseHolders[0]?.employeeRecordId === employeeRecordId
      );
    }
  );
}
