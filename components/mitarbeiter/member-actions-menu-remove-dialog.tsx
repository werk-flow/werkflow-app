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

type MemberRemoveConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  memberName: string;
  removalBlockedMessage: string | undefined;
  error: string | null;
  isRemoving: boolean;
  onRemove: () => Promise<void>;
};

export function MemberRemoveConfirmDialog({
  open,
  onOpenChange,
  memberName,
  removalBlockedMessage,
  error,
  isRemoving,
  onRemove,
}: MemberRemoveConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange} pending={isRemoving}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {removalBlockedMessage ? 'Mitglied kann noch nicht entfernt werden' : 'Mitglied entfernen?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {removalBlockedMessage ? (
              removalBlockedMessage
            ) : (
              <>
                Bist du sicher, dass du <span className="font-medium">{memberName || 'dieses Mitglied'}</span>{' '}
                aus der Organisation entfernen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter error={error}>
          <AlertDialogCancel disabled={isRemoving}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            // Keep the dialog open until the server confirms; a failure
            // must stay visible at the point of action.
            onClick={(event) => {
              event.preventDefault();
              void onRemove();
            }}
            pending={isRemoving}
            disabled={Boolean(removalBlockedMessage)}
            variant="destructive"
          >
            {isRemoving ? 'Wird entfernt…' : removalBlockedMessage ? 'Zuerst neu zuweisen' : 'Entfernen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
