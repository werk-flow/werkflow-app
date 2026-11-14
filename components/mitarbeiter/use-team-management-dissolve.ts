'use client';

import { useState } from 'react';
import type { useBusyIds } from '@/hooks/use-busy-id';
import { useBanner } from '@/components/ui/banner';
import { dissolveTeam } from '@/lib/qualifications/actions';
import type { Team } from '@/lib/qualifications/types';

type TeamManagementDissolveInput = {
  runAction: ReturnType<typeof useBusyIds>['run'];
  refresh: () => void;
};

const DISSOLVE_FAILED = 'Das Team konnte nicht aufgelöst werden.';

/** The team picked for dissolving and its confirmed dissolve call. */
export function useTeamManagementDissolve({ runAction, refresh }: TeamManagementDissolveInput) {
  const { showBanner } = useBanner();
  const [teamToDissolve, setTeamToDissolve] = useState<Team | null>(null);

  /** Answers the failure the confirmation shows, or null once the team is dissolved. */
  const handleDissolve = async (): Promise<string | null> => {
    const team = teamToDissolve;
    if (!team) return null;
    const result = await runAction(`dissolve:${team.id}`, () => dissolveTeam({ teamId: team.id }));
    if (!result.success) return DISSOLVE_FAILED;
    showBanner({ variant: 'success', message: 'Das Team wurde aufgelöst.' });
    refresh();
    return null;
  };

  return { teamToDissolve, setTeamToDissolve, handleDissolve };
}
