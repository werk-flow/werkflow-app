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
import { formatGermanDate } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';

type VersionDeleteDialogProps = {
  /** The question in the title, such as „Kondition löschen?“. */
  title: string;
  /** The version with its article, such as „Die Kondition“; the date follows it. */
  subject: string;
  deleteTarget: { validFrom: string } | null;
  deleteError: string | null;
  isDeleting: boolean;
  onClose: () => void;
  onDelete: () => void;
};

/** The delete confirmation of a dated personnel version (a condition or a weekly schedule). */
export function VersionDeleteDialog({
  title,
  subject,
  deleteTarget,
  deleteError,
  isDeleting,
  onClose,
  onDelete,
}: VersionDeleteDialogProps) {
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
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {subject} ab {deleteTarget ? formatGermanDate(deleteTarget.validFrom) : ''} wird entfernt. Die
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
