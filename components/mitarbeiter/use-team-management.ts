'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import type { QualificationWorkspace, Team } from '@/lib/qualifications/types';
import { useBusyIds } from '@/hooks/use-busy-id';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useTeamManagementDissolve } from './use-team-management-dissolve';
import { useTeamManagementMemberships, type TeamMembership } from './use-team-management-memberships';
import { useTeamManagementTeamEdits } from './use-team-management-team-edits';

const getTeamRecordId = (record: Team | TeamMembership) => record.id;

export type TeamManagementInput = Pick<QualificationWorkspace, 'teams' | 'teamMemberships' | 'employees'>;

export type TeamManagementController = ReturnType<typeof useTeamManagement>;

/**
 * State and mutations of the team tab. One `useBusyIds` serializes create,
 * rename, dissolve and the membership changes: every control is disabled while
 * any of them runs.
 */
export function useTeamManagement({ teams, teamMemberships, employees }: TeamManagementInput) {
  const router = useRouter();
  const busy = useBusyIds();
  const today = getBusinessTodayIso();
  // A created team, a rename and a new member show in the first frame. The
  // echo ends when the refreshed workspace arrives; a refusal removes it and
  // shows the reason at the form.
  const teamList = useOptimisticList({ items: teams, getId: getTeamRecordId });
  const membershipList = useOptimisticList({ items: teamMemberships, getId: getTeamRecordId });
  const activeTeams = teamList.items.filter(({ item }) => !item.dissolvedAt);
  const dissolvedTeams = teams.filter((team) => team.dissolvedAt);
  const employeeById = useMemo(
    () => new Map(employees.map((employee) => [employee.employeeRecordId, employee])),
    [employees],
  );

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  useBusinessDayRefresh(refresh);
  const membershipRows = membershipList.items;
  const activeMembershipsByTeam = useMemo(() => {
    const membershipsByTeam = new Map<string, typeof membershipRows>();
    for (const row of membershipRows) {
      const membership = row.item;
      if (membership.validFrom > today || (membership.validUntil && membership.validUntil < today)) {
        continue;
      }
      const memberships = membershipsByTeam.get(membership.teamId) ?? [];
      memberships.push(row);
      membershipsByTeam.set(membership.teamId, memberships);
    }
    return membershipsByTeam;
  }, [membershipRows, today]);

  const settle = (list: { settle: (id: string) => void }, id: string) => {
    list.settle(id);
    refresh();
  };

  const teamEdits = useTeamManagementTeamEdits({ teamList, runAction: busy.run, settle });
  const dissolve = useTeamManagementDissolve({ runAction: busy.run, refresh });
  const memberships = useTeamManagementMemberships({
    membershipList,
    today,
    runAction: busy.run,
    refresh,
    settle,
  });

  return {
    today,
    employees,
    employeeById,
    activeTeams,
    dissolvedTeams,
    activeMembershipsByTeam,
    anyBusy: busy.anyBusy,
    isBusy: busy.isBusy,
    ...teamEdits,
    ...dissolve,
    ...memberships,
  };
}
