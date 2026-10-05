'use client';

import { useState } from 'react';
import type { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { createTeam, updateTeam } from '@/lib/qualifications/actions';
import type { Team } from '@/lib/qualifications/types';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { describeFailure } from '@/lib/action-messages';

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
    if (!name.trim()) {
      setNameError('Bitte gib einen Teamnamen an.');
      document.getElementById('new-team-name')?.focus();
      return;
    }
    setNameError(null);
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
  };

  const handleRename = async (team: Team, value: string) => {
    const nextName = value.trim();
    if (!nextName) {
      setRenameError('Bitte gib einen Teamnamen an.');
      document.getElementById(teamNameFieldId(team.id))?.focus();
      return;
    }
    setRenameError(null);
    if (nextName === team.name) {
      setEditingTeamId(null);
      return;
    }
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
