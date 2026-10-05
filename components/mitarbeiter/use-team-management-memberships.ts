'use client';

import { useState } from 'react';
import { useBanner } from '@/components/ui/banner';
import { addTeamMembership, endTeamMembership } from '@/lib/qualifications/actions';
import type { QualificationWorkspace, Team } from '@/lib/qualifications/types';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { describeFailure } from '@/lib/action-messages';

export type TeamMembership = QualificationWorkspace['teamMemberships'][number];

type TeamMembershipOptimisticList = Pick<
  ReturnType<typeof useOptimisticList<TeamMembership>>,
  'insert' | 'rollback' | 'settle'
>;

type TeamManagementMembershipsInput = {
  membershipList: TeamMembershipOptimisticList;
  today: string;
  setPendingAction: (action: string | null) => void;
  refresh: () => void;
  settle: (list: { settle: (id: string) => void }, id: string) => void;
};

/** Add a member to a team and end a membership; the add form state is per team. */
export function useTeamManagementMemberships({
  membershipList,
  today,
  setPendingAction,
  refresh,
  settle,
}: TeamManagementMembershipsInput) {
  const { showBanner } = useBanner();
  const [addErrorByTeam, setAddErrorByTeam] = useState<Record<string, string>>({});
  const [addFieldErrorsByTeam, setAddFieldErrorsByTeam] = useState<
    Record<string, { member?: string | undefined; validUntil?: string | undefined }>
  >({});
  const [selectedEmployeeByTeam, setSelectedEmployeeByTeam] = useState<Record<string, string>>({});
  const [membershipWindowByTeam, setMembershipWindowByTeam] = useState<
    Record<string, { validFrom: string; validUntil: string }>
  >({});

  const handleEndMembership = async (membership: TeamMembership) => {
    setPendingAction(`end:${membership.id}`);
    try {
      const result = await endTeamMembership({
        membershipId: membership.id,
        validUntil: today,
      });
      if (!result.success) {
        showBanner({
          variant: 'error',
          message: 'Die Teamzugehörigkeit konnte nicht beendet werden.',
        });
        return;
      }
      showBanner({
        variant: 'success',
        message: 'Die Teamzugehörigkeit wurde zum Tagesende beendet.',
      });
      refresh();
    } catch {
      showBanner({
        variant: 'error',
        message: 'Die Teamzugehörigkeit konnte nicht beendet werden.',
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleAddMembership = async (team: Team) => {
    const employeeRecordId = selectedEmployeeByTeam[team.id];
    const membershipWindow = membershipWindowByTeam[team.id];
    const validFrom = membershipWindow?.validFrom ?? today;
    const validUntil = membershipWindow?.validUntil || null;
    const setAddError = (message: string | null) =>
      setAddErrorByTeam((current) => {
        const next = { ...current };
        if (message) next[team.id] = message;
        else delete next[team.id];
        return next;
      });
    setAddError(null);
    const fieldErrors = {
      member: employeeRecordId ? undefined : 'Bitte wähle einen Mitarbeiter aus.',
      validUntil:
        validUntil && validUntil < validFrom ? '„Gültig bis“ darf nicht vor „Gültig ab“ liegen.' : undefined,
    };
    setAddFieldErrorsByTeam((current) => ({
      ...current,
      [team.id]: fieldErrors,
    }));
    if (!employeeRecordId || fieldErrors.validUntil) {
      document
        .getElementById(fieldErrors.member ? `team-${team.id}-member` : `team-${team.id}-valid-until`)
        ?.focus();
      return;
    }
    setPendingAction(`add:${team.id}`);
    const draftId = crypto.randomUUID();
    membershipList.insert(draftId, {
      id: draftId,
      organizationId: team.organizationId,
      teamId: team.id,
      employeeRecordId,
      validFrom,
      validUntil,
      createdAt: '',
      updatedAt: '',
    });
    try {
      const result = await addTeamMembership({
        teamId: team.id,
        employeeRecordId,
        validFrom,
        validUntil,
      });
      if (!result.success) {
        membershipList.rollback(draftId);
        setAddError(
          describeFailure(
            result.error,
            { overlap: 'Diese Teamzugehörigkeit besteht bereits.' },
            'Das Teammitglied konnte nicht hinzugefügt werden.',
          ),
        );
        return;
      }
      setSelectedEmployeeByTeam((current) => ({
        ...current,
        [team.id]: '',
      }));
      setMembershipWindowByTeam((current) => ({
        ...current,
        [team.id]: { validFrom: today, validUntil: '' },
      }));
      showBanner({
        variant: 'success',
        message: 'Das Teammitglied wurde hinzugefügt.',
      });
      settle(membershipList, draftId);
    } catch {
      membershipList.rollback(draftId);
      setAddError('Das Teammitglied konnte nicht hinzugefügt werden.');
    } finally {
      setPendingAction(null);
    }
  };

  return {
    handleEndMembership,
    selectedEmployeeByTeam,
    setSelectedEmployeeByTeam,
    membershipWindowByTeam,
    setMembershipWindowByTeam,
    addFieldErrorsByTeam,
    addErrorByTeam,
    handleAddMembership,
  };
}
