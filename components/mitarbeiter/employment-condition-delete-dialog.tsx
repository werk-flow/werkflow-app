'use client';

import { ErrorText } from '@/components/ui/error-text';
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
import type { EmploymentCondition } from '@/lib/personnel/types';
import { formatGermanDate } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

type EmploymentConditionDeleteDialogProps = {
  deleteTarget: EmploymentCondition | null;
  deleteError: string | null;
  isDeleting: boolean;
  onClose: () => void;
  onDelete: () => void;
};

export function EmploymentConditionDeleteDialog({
  deleteTarget,
  deleteError,
  isDeleting,
  onClose,
  onDelete,
}: EmploymentConditionDeleteDialogProps) {
  return (
    <AlertDialog
      open={deleteTarget !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pending={isDeleting}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kondition löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Die Kondition ab {deleteTarget ? formatGermanDate(deleteTarget.validFrom) : ''} wird entfernt. Die
            Löschung wird im Verlauf nachvollziehbar festgehalten.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{deleteError}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            disabled={isDeleting}
            variant="destructive"
          >
            {isDeleting ? (
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
