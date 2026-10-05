'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { updateMemberRole, removeMember, type OrgRole, type MemberDetail } from '@/lib/members/actions';
import { ROLE_LABELS } from '@/lib/roles';
import type { PersonnelDetail } from '@/lib/personnel/actions';
import type { ResponsibilitySettingsData } from '@/lib/responsibilities/server';
import { getResponsibilitiesStrandedByEmployeeRemoval } from '@/lib/responsibilities/resolution';
import { getMemberActionErrorMessage, getResponsibilityRemovalBlockMessage } from '@/lib/members/errors';
import { loadDocument } from '@/lib/navigation/document-load';
import { untilPageLeaves, usePendingTask, useServerAction } from '@/hooks/use-server-action';

const ROLE_HIERARCHY: Record<OrgRole, number> = {
  admin: 1,
  buero: 2,
  employee: 3,
};

const ADMIN_ASSIGNABLE_ROLES: OrgRole[] = ['buero', 'employee'];

const BUERO_ASSIGNABLE_ROLES: OrgRole[] = ['employee'];

// Without the record or the responsibilities the check cannot run, so removal
// stays blocked until a reload succeeds instead of looking unblocked.
const REMOVAL_CHECK_FAILED_MESSAGE =
  'Die Verantwortlichkeiten konnten nicht geprüft werden. Lade die Seite neu und versuche es dann erneut.';

type MitarbeiterDetailMemberActionsInput = {
  member: MemberDetail;
  fullName: string;
  personnel: PersonnelDetail | null;
  personnelLoadFailed: boolean;
  currentUserId: string;
  currentUserRole: OrgRole;
  /** `null` when the responsibility settings failed to load. */
  responsibilitySettings: ResponsibilitySettingsData | null;
};

export type MitarbeiterDetailMemberActions = ReturnType<typeof useMitarbeiterDetailMemberActions>;

/** Role change and removal of the member shown on the detail page. */
export function useMitarbeiterDetailMemberActions({
  member,
  fullName,
  personnel,
  personnelLoadFailed,
  currentUserId,
  currentUserRole,
  responsibilitySettings,
}: MitarbeiterDetailMemberActionsInput) {
  const router = useRouter();
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const { run: runRemove, isPending: isRemoving } = usePendingTask();
  const { run: runRoleUpdate, isPending: isUpdatingRole } = useServerAction(updateMemberRole);
  const [actionError, setActionError] = useState<string | null>(null);

  const isOwnRow = member.userId === currentUserId;
  const canManage =
    !isOwnRow &&
    member.role !== 'admin' &&
    (currentUserRole === 'admin' ||
      (currentUserRole === 'buero' && ROLE_HIERARCHY[member.role] > ROLE_HIERARCHY['buero']));

  const removalBlockedMessage = useMemo(() => {
    if (personnelLoadFailed) return REMOVAL_CHECK_FAILED_MESSAGE;
    if (!personnel) return null;
    if (!responsibilitySettings) return REMOVAL_CHECK_FAILED_MESSAGE;
    return getResponsibilityRemovalBlockMessage(
      getResponsibilitiesStrandedByEmployeeRemoval(responsibilitySettings.effective, personnel.record.id),
    );
  }, [personnel, personnelLoadFailed, responsibilitySettings]);

  const availableRoles = useMemo(() => {
    const assignable = currentUserRole === 'admin' ? ADMIN_ASSIGNABLE_ROLES : BUERO_ASSIGNABLE_ROLES;
    return assignable.filter((r) => r !== member.role);
  }, [currentUserRole, member.role]);

  const roleOptions = useMemo(() => {
    if (!canManage) return undefined;
    const assignable = currentUserRole === 'admin' ? ADMIN_ASSIGNABLE_ROLES : BUERO_ASSIGNABLE_ROLES;
    return assignable.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  }, [canManage, currentUserRole]);

  const handleRoleChange = async (newRole: OrgRole) => {
    if (isUpdatingRole) return;
    setActionError(null);
    // A thrown action (network loss) reads as the generic failure instead of a stuck control.
    const result = await runRoleUpdate(member.userId, newRole).catch(() => ({
      success: false as const,
      error: undefined,
    }));
    if (result.success) {
      router.refresh();
    } else {
      setActionError(getMemberActionErrorMessage(result.error));
    }
  };

  const handleRemove = async () => {
    if (isRemoving) return;
    setActionError(null);
    await runRemove(async () => {
      const result = await removeMember(member.userId).catch(() => ({
        success: false as const,
        error: undefined,
      }));
      if (result.success) {
        // Hard navigation: the refresh of this now-removed member's detail
        // redirects to plain /mitarbeiter and can land after a soft push,
        // dropping the banner param (documented post-delete race). Removal
        // stays pending until the page leaves.
        loadDocument(`/mitarbeiter?removed_member=${encodeURIComponent(fullName)}`);
        return untilPageLeaves();
      }
      setActionError(getMemberActionErrorMessage(result.error));
    });
  };

  return {
    canManage,
    availableRoles,
    roleOptions,
    removalBlockedMessage,
    showRemoveDialog,
    setShowRemoveDialog,
    isRemoving,
    isUpdatingRole,
    actionError,
    handleRoleChange,
    handleRemove,
  };
}
