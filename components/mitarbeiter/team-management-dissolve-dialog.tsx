'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ErrorText } from '@/components/ui/error-text';
import { InlinePending } from '@/components/ui/inline-pending';
import type { TeamManagementController } from './use-team-management';

type TeamManagementDissolveDialogProps = {
  management: TeamManagementController;
};

export function TeamManagementDissolveDialog({ management }: TeamManagementDissolveDialogProps) {
  const {
    teamToDissolve,
    setTeamToDissolve,
    dissolveError,
    setDissolveError,
    pendingAction,
    handleDissolve,
  } = management;
  // The dialog stays until the dissolve settles, so its outcome shows at the point of action.
  const isDissolving = pendingAction?.startsWith('dissolve:') ?? false;
  return (
    <AlertDialog
      open={Boolean(teamToDissolve)}
      onOpenChange={(open) => {
        if (open) return;
        setTeamToDissolve(null);
        setDissolveError(null);
      }}
      pending={isDissolving}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Team auflösen?</AlertDialogTitle>
          <AlertDialogDescription>
            {teamToDissolve?.name} bleibt mit seiner Historie erhalten, steht aber nicht mehr für neue
            Planungen zur Auswahl.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{dissolveError}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDissolving}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pendingAction !== null} onClick={handleDissolve}>
            Team auflösen
            <InlinePending active={isDissolving} label="Team wird aufgelöst" />
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
