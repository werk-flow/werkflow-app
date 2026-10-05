'use client';

import { Badge } from '@/components/ui/badge';
import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { EmploymentStateBadge } from './personnel-state-badges';
import { getEmploymentState } from '@/lib/personnel/types';
import type { PersonnelDetail } from '@/lib/personnel/actions';
import type { MemberDetail } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import { MitarbeiterDetailActionsMenu } from './mitarbeiter-detail-member-actions';
import type { MitarbeiterDetailMemberActions } from './use-mitarbeiter-detail-member-actions';

type MitarbeiterDetailHeaderProps = {
  member: MemberDetail;
  personnel: PersonnelDetail | null;
  fullName: string;
  memberActions: MitarbeiterDetailMemberActions;
};

export function MitarbeiterDetailHeader({
  member,
  personnel,
  fullName,
  memberActions,
}: MitarbeiterDetailHeaderProps) {
  const { canManage, availableRoles, isUpdatingRole, handleRoleChange, setShowRemoveDialog } = memberActions;

  const breadcrumbs = [{ label: 'Mitarbeiter', href: '/mitarbeiter' }, { label: fullName }];

  return (
    <DetailPageHeader
      breadcrumbs={breadcrumbs}
      title={fullName}
      subtitle={member.email}
      badges={
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-xs">
            {ROLE_LABELS[member.role] || member.role}
          </Badge>
          {personnel && getEmploymentState(personnel.record) !== 'aktiv' && (
            <EmploymentStateBadge state={getEmploymentState(personnel.record)} />
          )}
        </span>
      }
      actions={
        canManage ? (
          <MitarbeiterDetailActionsMenu
            availableRoles={availableRoles}
            isUpdatingRole={isUpdatingRole}
            onRoleChange={handleRoleChange}
            onRemoveRequest={() => setShowRemoveDialog(true)}
          />
        ) : undefined
      }
    />
  );
}
