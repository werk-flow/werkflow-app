'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Trash2, Pencil } from 'lucide-react';

import { ErrorText } from '@/components/ui/error-text';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
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
import { EditJobDialog } from '../forms/edit-job-dialog';
import { describeFailure } from '@/lib/action-messages';
import { deleteJob } from '@/lib/jobs/actions';
import { JOB_DELETE_FAILED_MESSAGE, JOB_DELETE_HISTORY_MESSAGE } from '@/lib/jobs/messages';
import { getJobDisplayTitle, type Client, type Job, type ProjectWithDetails } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { Spinner } from '@/components/ui/spinner';

const JOB_DELETE_ERROR_MESSAGES = {
  planning_history_exists: JOB_DELETE_HISTORY_MESSAGE,
} satisfies Record<string, string>;

export function describeJobDeleteError(error: string): string {
  return describeFailure(error, JOB_DELETE_ERROR_MESSAGES, JOB_DELETE_FAILED_MESSAGE);
}

interface JobActionsMenuProps {
  job: Job;
  detailHref: string;
  clients: Client[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
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

export function JobActionsMenu({
  job,
  detailHref,
  clients,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
  onDeleteRequested,
}: JobActionsMenuProps) {
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

  const isLoading = isDeleting;

  return (
    <>
      <RowActionsMenu
        disabled={isLoading}
        actions={[
          {
            label: 'Details anzeigen',
            icon: <ExternalLink className="size-4" />,
            onSelect: () => router.push(detailHref),
          },
          {
            label: 'Bearbeiten',
            icon: <Pencil className="size-4" />,
            onSelect: () => setShowEditDialog(true),
          },
          {
            label: 'Löschen',
            icon: <Trash2 className="size-4" />,
            onSelect: () => setShowDeleteDialog(true),
            variant: 'destructive',
            separatorBefore: true,
          },
        ]}
      />

      <AlertDialog
        open={showDeleteDialog}
        pending={isDeleting}
        onOpenChange={(open) => {
          setShowDeleteDialog(open);
          if (!open) setError(null);
        }}
      >
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
          <ErrorText>{error}</ErrorText>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
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

      <EditJobDialog
        job={job}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        clients={clients}
        members={members}
        projects={projects}
        onSuccess={onJobUpdated}
      />
    </>
  );
}
