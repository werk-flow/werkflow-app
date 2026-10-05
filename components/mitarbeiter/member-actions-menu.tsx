'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, UserCog, UserMinus, Loader2, ExternalLink } from 'lucide-react';

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
import { removeMember, type OrgRole } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import { getMemberActionErrorMessage } from '@/lib/members/errors';
import { MemberRemoveConfirmDialog } from './member-actions-menu-remove-dialog';
import { loadDocument } from '@/lib/navigation/document-load';

// Role hierarchy - lower number = higher rank
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 1,
  buero: 2,
  employee: 3,
};

const ADMIN_ASSIGNABLE_ROLES: OrgRole[] = ['buero', 'employee'];

const BUERO_ASSIGNABLE_ROLES: OrgRole[] = ['employee'];

interface MemberActionsMenuProps {
  memberId: string;
  memberName: string;
  memberFirstName: string;
  memberLastName: string;
  memberRole: OrgRole;
  currentUserId: string;
  currentUserRole: OrgRole;
  removalBlockedMessage?: string | undefined;
  /** The list has a change for this row in flight (role change settling). */
  isBusy?: boolean;
  /**
   * The list owns the role change: optimistic role, the server call, the
   * rollback and the banner, so the row shows pending until props land.
   */
  onRoleChange: (memberId: string, newRole: OrgRole, firstName: string, lastName: string) => Promise<void>;
}

export function MemberActionsMenu({
  memberId,
  memberName,
  memberFirstName,
  memberLastName,
  memberRole,
  currentUserId,
  currentUserRole,
  removalBlockedMessage,
  isBusy = false,
  onRoleChange,
}: MemberActionsMenuProps) {
  const router = useRouter();
  const [isRemoving, setIsRemoving] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if this is the current user's own row
  const isOwnRow = memberId === currentUserId;

  const canBueroManage = currentUserRole === 'buero' && ROLE_HIERARCHY[memberRole] > ROLE_HIERARCHY['buero'];

  // Admins can manage anyone except themselves
  const canAdminManage = currentUserRole === 'admin' && !isOwnRow && memberRole !== 'admin';

  // Determine if current user can actually manage this member
  const canActuallyManage = canAdminManage || canBueroManage;

  const getAvailableRoles = (): OrgRole[] => {
    if (!canActuallyManage) return [];
    const assignableRoles = currentUserRole === 'admin' ? ADMIN_ASSIGNABLE_ROLES : BUERO_ASSIGNABLE_ROLES;
    return assignableRoles.filter((role) => role !== memberRole);
  };

  const handleRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    setError(null);

    try {
      const result = await removeMember(memberId);

      if (result.success) {
        setShowRemoveDialog(false);
        // Keep isRemoving true - component unmounts after navigation
        // and the destination page shows the success banner.
        // Hard navigation: a Realtime-triggered refresh of the removed
        // member's surface can redirect to plain /mitarbeiter and land after a
        // soft push, dropping the banner param (the documented post-delete
        // race; same remedy as the customer delete).
        loadDocument(`/mitarbeiter?removed_member=${encodeURIComponent(memberName || 'Mitglied')}`);
      } else {
        setError(getMemberActionErrorMessage(result.error));
        setIsRemoving(false);
      }
    } catch {
      setError(getMemberActionErrorMessage(undefined));
      setIsRemoving(false);
    }
  };

  // Don't render anything if user can't manage this member
  if (!canActuallyManage) {
    return null;
  }

  const availableRoles = getAvailableRoles();

  // Show loading state for either role change or member removal
  const isLoading = isBusy || isRemoving;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isLoading}>
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
            <span className="sr-only">Aktionen öffnen</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => router.push(`/mitarbeiter/${memberId}`)}>
            <ExternalLink className="size-4" />
            Details anzeigen
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {availableRoles.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <UserCog className="size-4" />
                Rolle ändern
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {availableRoles.map((role) => (
                  <DropdownMenuItem
                    key={role}
                    onClick={() => void onRoleChange(memberId, role, memberFirstName, memberLastName)}
                  >
                    {ROLE_LABELS[role]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setShowRemoveDialog(true)}>
            <UserMinus className="size-4" />
            Entfernen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MemberRemoveConfirmDialog
        open={showRemoveDialog}
        onOpenChange={setShowRemoveDialog}
        memberName={memberName}
        removalBlockedMessage={removalBlockedMessage}
        error={error}
        isRemoving={isRemoving}
        onRemove={handleRemove}
      />
    </>
  );
}
