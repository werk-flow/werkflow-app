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
import { formatGermanDate } from '@/lib/utils';

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
        <AlertDialogFooter error={deleteError}>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            pending={isDeleting}
            variant="destructive"
          >
            {isDeleting ? 'Wird gelöscht…' : 'Löschen'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
