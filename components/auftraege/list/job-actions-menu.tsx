'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import { lazyDialog } from '@/components/shared/lazy-dialog';
import { untilPageLeaves, usePendingTask } from '@/hooks/use-server-action';
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
import { describeFailure } from '@/lib/action-messages';
import { deleteJob } from '@/lib/jobs/actions';
import {
  JOB_DELETE_FAILED_MESSAGE,
  JOB_DELETE_HISTORY_MESSAGE,
  JOB_DELETE_MATERIAL_MESSAGE,
} from '@/lib/jobs/messages';
import { getJobDisplayTitle, type Job, type ProjectWithDetails } from '@/lib/jobs/types';
import { knownProjectOption } from '../forms/job-form-options';
import { rowMenuActions } from './job-actions-menu-items';
import type { OrgMemberOption } from '../shared/employee-multi-select';

// Only Admin and Büro see a row menu. The edit form downloads when one opens,
// so the field worker's cold start never carries it (`lab.field.cold-start`).
const lazyEditJobDialog = lazyDialog(() =>
  import('../forms/edit-job-dialog').then((mod) => mod.EditJobDialog),
);

const JOB_DELETE_ERROR_MESSAGES = {
  planning_history_exists: JOB_DELETE_HISTORY_MESSAGE,
  material_history_exists: JOB_DELETE_MATERIAL_MESSAGE,
} satisfies Record<string, string>;

export function describeJobDeleteError(error: string): string {
  return describeFailure(error, JOB_DELETE_ERROR_MESSAGES, JOB_DELETE_FAILED_MESSAGE);
}

interface JobActionsMenuProps {
  job: Job;
  detailHref: string;
  /** The customer name the row shows. */
  clientName: string;
  members: OrgMemberOption[];
  /** The job's parent project, when the list shows it. */
  knownProject?: ProjectWithDetails | undefined;
  onJobUpdated?:
    | ((payload: { job: Job; selectedEmployeeIds?: string[] }) => void | Promise<void>)
    | undefined;
  onJobDeleted?: ((jobId: string) => void | Promise<void>) | undefined;
  /**
   * Optimistic list mode (feedback canon): the confirm closes at once and the
   * list owns the delete — row removal, server call, rollback, banners.
   * `onJobDeleted` is not called on that path.
   */
  onDeleteRequested?: ((jobId: string) => void) | undefined;
}

type JobDeleteStateInput = Pick<JobActionsMenuProps, 'job' | 'onJobDeleted' | 'onDeleteRequested'>;

/** The menu's dialog state and the delete, run here or handed to the optimistic list. */
function useJobActionsMenuState({ job, onJobDeleted, onDeleteRequested }: JobDeleteStateInput) {
  const router = useRouter();
  const displayTitle = getJobDisplayTitle(job);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { run: runDelete, isPending: isDeleting } = usePendingTask();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (isDeleting) return;
    if (onDeleteRequested) {
      setShowDeleteDialog(false);
      onDeleteRequested(job.id);
      return;
    }
    setError(null);

    await runDelete(async () => {
      try {
        const result = await deleteJob(job.id);

        if (!result.success) {
          setError(describeJobDeleteError(result.error));
          return;
        }

        setShowDeleteDialog(false);
        if (onJobDeleted) {
          // The row may stay mounted; the task ends here and releases its menu and a later dialog.
          await onJobDeleted(job.id);
        } else {
          router.push(`/auftraege?deleted_job=${encodeURIComponent(displayTitle)}`);
          return untilPageLeaves();
        }
      } catch {
        setError(JOB_DELETE_FAILED_MESSAGE);
      }
    });
  };

  const handleDeleteDialogOpenChange = (open: boolean) => {
    setShowDeleteDialog(open);
    if (!open) setError(null);
  };

  return {
    router,
    displayTitle,
    showDeleteDialog,
    setShowDeleteDialog,
    showEditDialog,
    setShowEditDialog,
    isDeleting,
    error,
    handleDeleteDialogOpenChange,
    handleDelete,
  };
}

export function JobActionsMenu({
  job,
  detailHref,
  clientName,
  members,
  knownProject,
  onJobUpdated,
  onJobDeleted,
  onDeleteRequested,
}: JobActionsMenuProps) {
  const {
    router,
    displayTitle,
    showDeleteDialog,
    setShowDeleteDialog,
    showEditDialog,
    setShowEditDialog,
    isDeleting,
    error,
    handleDeleteDialogOpenChange,
    handleDelete,
  } = useJobActionsMenuState({ job, onJobDeleted, onDeleteRequested });

  // The trigger shows a spinner while the edit form downloads for this row.
  const editWaiting = lazyEditJobDialog.useWaiting(showEditDialog);

  return (
    <>
      <RowActionsMenu
        onOpen={lazyEditJobDialog.preload}
        disabled={isDeleting || editWaiting}
        actions={rowMenuActions({
          openDetails: () => router.push(detailHref),
          openEdit: () => setShowEditDialog(true),
          openDelete: () => setShowDeleteDialog(true),
        })}
      />

      <AlertDialog open={showDeleteDialog} pending={isDeleting} onOpenChange={handleDeleteDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Auftrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du den Auftrag{' '}
              <span className="font-medium">
                {job.jobNumber ? `${job.jobNumber} – ` : ''}
                {displayTitle}
              </span>{' '}
              löschen möchtest? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter error={error}>
            <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              pending={isDeleting}
              variant="destructive"
            >
              {isDeleting ? 'Wird gelöscht…' : 'Löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <lazyEditJobDialog.Dialog
        job={job}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        selectedClient={job.clientId ? { id: job.clientId, name: clientName } : null}
        members={members}
        knownProject={
          knownProject ? knownProjectOption(knownProject, job.clientId ? clientName : null) : undefined
        }
        onSuccess={onJobUpdated}
      />
    </>
  );
}
