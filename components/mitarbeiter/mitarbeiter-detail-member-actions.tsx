'use client';

import { MoreVertical, UserCog, UserMinus, Loader2 } from 'lucide-react';

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
import type { OrgRole } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';

type MitarbeiterDetailActionsMenuProps = {
  availableRoles: OrgRole[];
  isUpdatingRole: boolean;
  onRoleChange: (role: OrgRole) => Promise<void>;
  onRemoveRequest: () => void;
};

export function MitarbeiterDetailActionsMenu({
  availableRoles,
  isUpdatingRole,
  onRoleChange,
  onRemoveRequest,
}: MitarbeiterDetailActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Aktionen"
          disabled={isUpdatingRole}
        >
          {isUpdatingRole ? <Loader2 className="size-4 animate-spin" /> : <MoreVertical className="size-4" />}
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
                <DropdownMenuItem key={role} onClick={() => onRoleChange(role)}>
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
  );
}
