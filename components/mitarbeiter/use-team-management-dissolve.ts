'use client';

import { useState, type MouseEvent } from 'react';
import { useBanner } from '@/components/ui/banner';
import { dissolveTeam } from '@/lib/qualifications/actions';
import type { Team } from '@/lib/qualifications/types';

type TeamManagementDissolveInput = {
  setPendingAction: (action: string | null) => void;
  refresh: () => void;
};

/** The team picked for dissolving and its confirmed dissolve call. */
export function useTeamManagementDissolve({ setPendingAction, refresh }: TeamManagementDissolveInput) {
  const { showBanner } = useBanner();
  const [teamToDissolve, setTeamToDissolve] = useState<Team | null>(null);
  const [dissolveError, setDissolveError] = useState<string | null>(null);

  const handleDissolve = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const team = teamToDissolve;
    if (!team) return;
    setDissolveError(null);
    setPendingAction(`dissolve:${team.id}`);
    void dissolveTeam({ teamId: team.id })
      .then((result) => {
        if (!result.success) {
          setDissolveError('Das Team konnte nicht aufgelöst werden.');
          return;
        }
        setTeamToDissolve(null);
        showBanner({
          variant: 'success',
          message: 'Das Team wurde aufgelöst.',
        });
        refresh();
      })
      .catch(() => {
        setDissolveError('Das Team konnte nicht aufgelöst werden.');
      })
      .finally(() => {
        setPendingAction(null);
      });
  };

  return {
    teamToDissolve,
    setTeamToDissolve,
    dissolveError,
    setDissolveError,
    handleDissolve,
  };
}
