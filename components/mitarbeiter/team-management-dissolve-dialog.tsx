'use client';

import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog';
import type { TeamManagementController } from './use-team-management';

type TeamManagementDissolveDialogProps = {
  management: TeamManagementController;
};

export function TeamManagementDissolveDialog({ management }: TeamManagementDissolveDialogProps) {
  const { teamToDissolve, setTeamToDissolve, anyBusy, isBusy, handleDissolve } = management;
  const isDissolving = teamToDissolve !== null && isBusy(`dissolve:${teamToDissolve.id}`);
  return (
    <ConfirmActionDialog
      open={Boolean(teamToDissolve)}
      onOpenChange={(open) => !open && setTeamToDissolve(null)}
      title="Team auflösen?"
      description={`${teamToDissolve?.name ?? ''} bleibt mit seiner Historie erhalten, steht aber nicht mehr für neue Planungen zur Auswahl.`}
      confirmLabel="Team auflösen"
      variant="destructive"
      // Another team action still runs: one change at a time.
      confirmDisabled={anyBusy && !isDissolving}
      onConfirm={handleDissolve}
    />
  );
}
