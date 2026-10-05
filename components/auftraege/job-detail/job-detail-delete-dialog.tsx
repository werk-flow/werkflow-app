'use client';

import { useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { usePendingTask } from '@/hooks/use-server-action';
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
import { deleteJob } from '@/lib/jobs/actions';
import { JOB_DELETE_FAILED_MESSAGE } from '@/lib/jobs/messages';
import { loadDocument } from '@/lib/navigation/document-load';
import { describeJobDeleteError } from '../list/job-actions-menu';

type JobDetailDeleteDialogProps = {
  open: boolean;
  setShowDeleteDialog: (open: boolean) => void;
  jobId: string;
  displayTitle: string;
  projectNumber: string | null | undefined;
  // Owned by the page: both gate its Realtime refresh while the delete runs.
  isDeletingRef: RefObject<boolean>;
  suppressRefreshRef: RefObject<boolean>;
};

export function JobDetailDeleteDialog({
  open,
  setShowDeleteDialog,
  jobId,
  displayTitle,
  projectNumber,
  isDeletingRef,
  suppressRefreshRef,
}: JobDetailDeleteDialogProps) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { run: runDeleteTask, isPending: isDeleting } = usePendingTask();

  const handleDelete = () => {
    setDeleteError(null);
    isDeletingRef.current = true;
    suppressRefreshRef.current = true;
    void runDeleteTask(async () => {
      let errorMessage: string | null = null;
      try {
        const result = await deleteJob(jobId);
        if (result.success) {
          const deletedParam = `?deleted_job=${encodeURIComponent(displayTitle)}`;
          // Full document load: see the deletion-stall note in components/kunden/use-client-deletion.ts.
          loadDocument(
            projectNumber
              ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}${deletedParam}`
              : `/auftraege${deletedParam}`,
          );
          return;
        }
        errorMessage = describeJobDeleteError(result.error);
      } catch {
        errorMessage = JOB_DELETE_FAILED_MESSAGE;
      }
      isDeletingRef.current = false;
      suppressRefreshRef.current = false;
      setDeleteError(errorMessage);
    });
  };

  return (
    <AlertDialog
      open={open}
      pending={isDeleting}
      onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) setDeleteError(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Auftrag löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Möchtest du den Auftrag &ldquo;{displayTitle}&rdquo; wirklich löschen? Diese Aktion kann nicht
            rückgängig gemacht werden.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{deleteError}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Radix closes on click by default; stay open so the spinner
              // and a failure are visible where the user acted.
              event.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            variant="destructive"
          >
            {isDeleting && <Loader2 className="mr-2 size-4 animate-spin" />}
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
