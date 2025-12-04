'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MoreHorizontal, UserCog, UserMinus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import {
  updateMemberRole,
  removeMember,
  type OrgRole
} from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';

// Role hierarchy - lower number = higher rank
const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 1,
  manager: 2,
  accountant: 3,
  secretary: 4,
  employee: 5
};

// Roles that admins can assign (admin cannot be assigned)
const ADMIN_ASSIGNABLE_ROLES: OrgRole[] = [
  'manager',
  'accountant',
  'secretary',
  'employee'
];

// Roles that managers can assign (only roles below manager)
const MANAGER_ASSIGNABLE_ROLES: OrgRole[] = [
  'accountant',
  'secretary',
  'employee'
];

interface MemberActionsMenuProps {
  memberId: string;
  memberName: string;
  memberFirstName: string;
  memberLastName: string;
  memberRole: OrgRole;
  currentUserId: string;
  currentUserRole: OrgRole;
  onRoleChange?: (
    memberId: string,
    newRole: OrgRole,
    firstName: string,
    lastName: string
  ) => void;
}

export function MemberActionsMenu({
  memberId,
  memberName,
  memberFirstName,
  memberLastName,
  memberRole,
  currentUserId,
  currentUserRole,
  onRoleChange
}: MemberActionsMenuProps) {
  const router = useRouter();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if this is the current user's own row
  const isOwnRow = memberId === currentUserId;

  // Check if current user can manage this member
  const canManage =
    (currentUserRole === 'admin' || currentUserRole === 'manager') &&
    !isOwnRow &&
    memberRole !== 'admin';

  // Managers can only manage users below their level
  const canManagerManage =
    currentUserRole === 'manager' &&
    ROLE_HIERARCHY[memberRole] > ROLE_HIERARCHY['manager'];

  // Admins can manage anyone except themselves
  const canAdminManage =
    currentUserRole === 'admin' && !isOwnRow && memberRole !== 'admin';

  // Determine if current user can actually manage this member
  const canActuallyManage = canAdminManage || canManagerManage;

  // Get available roles for assignment based on current user's role
  const getAvailableRoles = (): OrgRole[] => {
    // Admins can assign up to manager, managers can only assign below manager
    const assignableRoles =
      currentUserRole === 'admin'
        ? ADMIN_ASSIGNABLE_ROLES
        : MANAGER_ASSIGNABLE_ROLES;
    // Filter out the current role (no point in assigning the same role)
    return assignableRoles.filter((role) => role !== memberRole);
  };

  const handleRoleChange = async (newRole: OrgRole) => {
    if (isUpdating) return;
    setIsUpdating(true);
    setError(null);

    const result = await updateMemberRole(memberId, newRole);

    if (result.success) {
      // Call the callback for optimistic UI update and banner display
      if (onRoleChange) {
        onRoleChange(memberId, newRole, memberFirstName, memberLastName);
      }
      // Refresh to get sorted data from server
      router.refresh();
    } else {
      setError(result.error || 'Fehler beim Ändern der Rolle');
    }

    setIsUpdating(false);
  };

  const handleRemove = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    setError(null);

    const result = await removeMember(memberId);

    if (result.success) {
      setShowRemoveDialog(false);
      // Keep isRemoving true - the row will show spinner until it's removed
      // when the table re-renders with fresh data after router.refresh()
      router.refresh();
      // Don't set isRemoving to false on success - component will unmount
    } else {
      setError(result.error || 'Fehler beim Entfernen des Mitglieds');
      setIsRemoving(false);
    }
  };

  // Don't render anything if user can't manage this member
  if (!canActuallyManage) {
    return null;
  }

  const availableRoles = getAvailableRoles();

  // Show loading state for either role change or member removal
  const isLoading = isUpdating || isRemoving;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
            <span className="sr-only">Aktionen öffnen</span>
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
                  <DropdownMenuItem
                    key={role}
                    onClick={() => handleRoleChange(role)}
                  >
                    {ROLE_LABELS[role]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setShowRemoveDialog(true)}
          >
            <UserMinus className="size-4" />
            Entfernen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mitglied entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du{' '}
              <span className="font-medium">
                {memberName || 'dieses Mitglied'}
              </span>{' '}
              aus der Organisation entfernen möchtest? Diese Aktion kann nicht
              rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              disabled={isRemoving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird entfernt...
                </>
              ) : (
                'Entfernen'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
