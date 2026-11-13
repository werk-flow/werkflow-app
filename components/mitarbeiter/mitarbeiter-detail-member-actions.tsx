'use client';

import { MoreVertical, UserCog, UserMinus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { OrgRole } from '@/lib/roles';
import { ROLE_LABELS } from '@/lib/roles';
import {
  RoleEscalationConfirmDialog,
  useConfirmedRoleChange,
  type RoleChange,
} from './role-escalation-confirm-dialog';

type MitarbeiterDetailActionsMenuProps = {
  memberName: string;
  memberRole: OrgRole;
  availableRoles: OrgRole[];
  isUpdatingRole: boolean;
  onRoleChange: RoleChange;
  onRoleChangeFailure: (message: string) => void;
  onRemoveRequest: () => void;
};

export function MitarbeiterDetailActionsMenu({
  memberName,
  memberRole,
  availableRoles,
  isUpdatingRole,
  onRoleChange,
  onRoleChangeFailure,
  onRemoveRequest,
}: MitarbeiterDetailActionsMenuProps) {
  const roleChange = useConfirmedRoleChange(memberRole, onRoleChange, onRoleChangeFailure);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            pending={isUpdatingRole}
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Aktionen"
            disabled={isUpdatingRole}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {availableRoles.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserCog className="size-4" />
                Rolle ändern
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {availableRoles.map((role) => (
                  <DropdownMenuItem key={role} onClick={() => roleChange.requestRoleChange(role)}>
                    {ROLE_LABELS[role]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onRemoveRequest}>
            <UserMinus className="size-4" />
            Entfernen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RoleEscalationConfirmDialog memberName={memberName} roleChange={roleChange} />
    </>
  );
}
