'use client';

import { useState } from 'react';
import type { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { createTeam, updateTeam } from '@/lib/qualifications/actions';
import type { Team } from '@/lib/qualifications/types';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { describeFailure } from '@/lib/action-messages';
import { focusFirstInvalidField } from '@/lib/ui/field-validation';

type TeamOptimisticList = Pick<
  ReturnType<typeof useOptimisticList<Team>>,
  'insert' | 'update' | 'rollback' | 'settle'
>;

type TeamManagementTeamEditsInput = {
  teamList: TeamOptimisticList;
  runAction: ReturnType<typeof useBusyIds>['run'];
  settle: (list: { settle: (id: string) => void }, id: string) => void;
};

/** Control id of a team's rename field. */
export function teamNameFieldId(teamId: string): string {
  return `team-name-${teamId}`;
}

type TeamCreation = TeamManagementTeamEditsInput & {
  name: string;
  description: string;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setName: (name: string) => void;
  setDescription: (description: string) => void;
  setCreateError: (error: string | null) => void;
};

/** Creates the validated team, echoed in the list until the server answers. */
async function createTeamDraft({
  name,
  description,
  teamList,
  runAction,
  settle,
  showBanner,
  setName,
  setDescription,
  setCreateError,
}: TeamCreation) {
  await runAction('create', async () => {
    setCreateError(null);
    const draftId = crypto.randomUUID();
    const now = new Date().toISOString();
    teamList.insert(draftId, {
      id: draftId,
      organizationId: '',
      name: name.trim(),
      description: description.trim() || null,
      dissolvedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    try {
      const result = await createTeam({ name, description });
      if (!result.success) {
        teamList.rollback(draftId);
        setCreateError(
          describeFailure(
            result.error,
            { duplicate_name: 'Ein aktives Team mit diesem Namen besteht bereits.' },
            'Das Team konnte nicht angelegt werden.',
          ),
        );
        return;
      }
      setName('');
      setDescription('');
      showBanner({ variant: 'success', message: 'Das Team wurde angelegt.' });
      settle(teamList, draftId);
    } catch {
      teamList.rollback(draftId);
      setCreateError('Das Team konnte nicht angelegt werden.');
    }
  });
}

type TeamRename = TeamManagementTeamEditsInput & {
  team: Team;
  nextName: string;
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  setEditingTeamId: (teamId: string | null) => void;
  setEditingTeamName: (name: string) => void;
};

/** Renames the team, echoed in the list; a refusal restores the name and reopens the field. */
async function renameTeam({
  team,
  nextName,
  teamList,
  runAction,
  settle,
  showBanner,
  setEditingTeamId,
  setEditingTeamName,
}: TeamRename) {
  await runAction(`rename:${team.id}`, async () => {
    setEditingTeamId(null);
    teamList.update(team.id, { ...team, name: nextName });
    const restore = () => {
      teamList.rollback(team.id);
      setEditingTeamId(team.id);
    };
    try {
      const result = await updateTeam({
        teamId: team.id,
        name: nextName,
        description: team.description,
      });
      if (!result.success) {
        restore();
        showBanner({
          variant: 'error',
          message: 'Der Teamname konnte nicht geändert werden.',
        });
        return;
      }
      setEditingTeamName('');
      showBanner({
        variant: 'success',
        message: 'Der Teamname wurde geändert.',
      });
      settle(teamList, team.id);
    } catch {
      restore();
      showBanner({
        variant: 'error',
        message: 'Der Teamname konnte nicht geändert werden.',
      });
    }
  });
}

/** Create and rename a team, each echoed in the optimistic team list. */
export function useTeamManagementTeamEdits({ teamList, runAction, settle }: TeamManagementTeamEditsInput) {
  const { showBanner } = useBanner();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  const handleCreate = async () => {
    const nextNameError = name.trim() ? undefined : 'Bitte gib einen Teamnamen an.';
    setNameError(nextNameError ?? null);
    if (focusFirstInvalidField({ 'new-team-name': nextNameError })) return;
    await createTeamDraft({
      name,
      description,
      teamList,
      runAction,
      settle,
      showBanner,
      setName,
      setDescription,
      setCreateError,
    });
  };

  const handleRename = async (team: Team, value: string) => {
    const nextName = value.trim();
    const nextRenameError = nextName ? undefined : 'Bitte gib einen Teamnamen an.';
    setRenameError(nextRenameError ?? null);
    if (focusFirstInvalidField({ [teamNameFieldId(team.id)]: nextRenameError })) return;
    if (nextName === team.name) {
      setEditingTeamId(null);
      return;
    }
    await renameTeam({
      team,
      nextName,
      teamList,
      runAction,
      settle,
      showBanner,
      setEditingTeamId,
      setEditingTeamName,
    });
  };

  return {
    name,
    setName,
    description,
    setDescription,
    nameError,
    createError,
    handleCreate,
    editingTeamId,
    setEditingTeamId: (teamId: string | null) => {
      setRenameError(null);
      setEditingTeamId(teamId);
    },
    editingTeamName,
    setEditingTeamName,
    renameError,
    handleRename,
  };
}
