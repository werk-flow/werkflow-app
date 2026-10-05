'use client';

import { useState, type MouseEvent } from 'react';
import type { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { dissolveTeam } from '@/lib/qualifications/actions';
import type { Team } from '@/lib/qualifications/types';

type TeamManagementDissolveInput = {
  runAction: ReturnType<typeof useBusyIds>['run'];
  refresh: () => void;
};

/** The team picked for dissolving and its confirmed dissolve call. */
export function useTeamManagementDissolve({ runAction, refresh }: TeamManagementDissolveInput) {
  const { showBanner } = useBanner();
  const [teamToDissolve, setTeamToDissolve] = useState<Team | null>(null);
  const [dissolveError, setDissolveError] = useState<string | null>(null);

  const handleDissolve = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const team = teamToDissolve;
    if (!team) return;
    setDissolveError(null);
    void runAction(`dissolve:${team.id}`, () =>
      dissolveTeam({ teamId: team.id })
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
        }),
    );
  };

  return {
    teamToDissolve,
    setTeamToDissolve,
    dissolveError,
    setDissolveError,
    handleDissolve,
  };
}
