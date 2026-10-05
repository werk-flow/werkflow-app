'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useBanner } from '@/components/ui/banner';
import type { OrgMember } from './members-table';
import { getRoleLabel } from '@/lib/roles';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { updateMemberRole, type OrgRole } from '@/lib/members/actions';
import { getMemberActionErrorMessage } from '@/lib/members/errors';

type MitarbeiterTabsRoleChangeInput = {
  /** The merged member list the table shows. */
  members: OrgMember[];
  /** The server list; the busy mark holds until it changes. */
  initialMembers: OrgMember[];
  updateMember: (id: string, next: OrgMember) => void;
  rollbackMember: (id: string) => void;
};

// Role change: the row flips at once and stays marked until the refreshed
// list lands; the banner fires only after the server confirmed, and a
// failure rolls the role back and reports at list level.
export function useMitarbeiterTabsRoleChange({
  members,
  initialMembers,
  updateMember,
  rollbackMember,
}: MitarbeiterTabsRoleChangeInput) {
  const router = useRouter();
  const { showBanner } = useBanner();
  const { run: runBusy, busyIds } = useBusyIds();
  const waitForMembers = useSettleOnChange(initialMembers);

  const handleRoleChange = useCallback(
    (memberId: string, newRole: OrgRole, firstName: string, lastName: string): Promise<void> => {
      const member = members.find((candidate) => candidate.user_id === memberId);
      if (!member) return Promise.resolve();
      const displayName = `${firstName} ${lastName}`.trim() || 'Mitglied';
      updateMember(memberId, { ...member, role: newRole });
      return runBusy(memberId, async () => {
        const result = await updateMemberRole(memberId, newRole).catch(() => null);
        if (!result || !result.success) {
          rollbackMember(memberId);
          showBanner({
            variant: 'error',
            message: `Die Rolle von ${displayName} konnte nicht geändert werden: ${getMemberActionErrorMessage(result?.error)}`,
          });
          return;
        }
        showBanner({
          variant: 'success',
          message: `Die Rolle von ${displayName} wurde erfolgreich zu ${getRoleLabel(newRole)} geändert.`,
        });
        router.refresh();
        await waitForMembers();
      });
    },
    [members, updateMember, rollbackMember, runBusy, router, showBanner, waitForMembers],
  );

  return { handleRoleChange, busyIds };
}
