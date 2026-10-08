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
import { Spinner } from '@/components/ui/spinner';

type InviteConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inviteEmail: string;
  error: string | null;
  isLoading: boolean;
  onConfirm: () => Promise<void>;
};

export function InviteCancelConfirmDialog({
  open,
  onOpenChange,
  inviteEmail,
  error,
  isLoading,
  onConfirm,
}: InviteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !isLoading && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Einladung stornieren?</AlertDialogTitle>
          <AlertDialogDescription>
            Bist du sicher, dass du die Einladung für <span className="font-medium">{inviteEmail}</span>{' '}
            stornieren möchtest? Der Einladungslink wird ungültig und kann nicht mehr verwendet werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{error}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            // Keep the dialog open until the server confirms; a failure
            // must stay visible at the point of action.
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2" />
                Wird storniert…
              </>
            ) : (
              'Stornieren'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function InviteDeleteConfirmDialog({
  open,
  onOpenChange,
  inviteEmail,
  error,
  isLoading,
  onConfirm,
}: InviteConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !isLoading && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Einladung löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Bist du sicher, dass du die Einladung für <span className="font-medium">{inviteEmail}</span>{' '}
            endgültig löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{error}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            disabled={isLoading}
            variant="destructive"
          >
            {isLoading ? (
              <>
                <Spinner className="mr-2" />
                Wird gelöscht…
              </>
            ) : (
              'Löschen'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
