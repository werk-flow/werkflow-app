'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
import { EditProjectDialog } from '../forms/edit-project-dialog';
import { deleteProject } from '@/lib/projects/actions';
import { type Job, type Project, type ProjectWithDetails } from '@/lib/jobs/types';
import { rowMenuActions } from './job-actions-menu-items';

export const PROJECT_DELETE_FAILED_MESSAGE = 'Das Projekt konnte nicht gelöscht werden.';

interface ProjectActionsMenuProps {
  project: ProjectWithDetails;
  detailHref: string;
  /** The customer name the row shows. */
  clientName: string;
  jobs: Job[];
  onProjectUpdated?:
    | ((payload: { project: Project; selectedJobIds?: string[] }) => void | Promise<void>)
    | undefined;
  onProjectDeleted?: ((projectId: string) => void | Promise<void>) | undefined;
  /**
   * Optimistic list mode (feedback canon): the confirm closes at once and the
   * list owns the delete — row removal, server call, rollback, banners.
   * `onProjectDeleted` is not called on that path.
   */
  onDeleteRequested?: ((projectId: string) => void) | undefined;
}

type ProjectDeleteStateInput = Pick<
  ProjectActionsMenuProps,
  'project' | 'onProjectDeleted' | 'onDeleteRequested'
>;

/** The menu's dialog state and the delete, run here or handed to the optimistic list. */
function useProjectActionsMenuState({
  project,
  onProjectDeleted,
  onDeleteRequested,
}: ProjectDeleteStateInput) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { run: runDelete, isPending: isDeleting } = usePendingTask();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (isDeleting) return;
    if (onDeleteRequested) {
      setShowDeleteDialog(false);
      onDeleteRequested(project.id);
      return;
    }
    setError(null);

    await runDelete(async () => {
      try {
        const result = await deleteProject(project.id);

        if (!result.success) {
          setError(PROJECT_DELETE_FAILED_MESSAGE);
          return;
        }

        setShowDeleteDialog(false);
        if (onProjectDeleted) {
          // The row may stay mounted; the task ends here and releases its menu and a later dialog.
          await onProjectDeleted(project.id);
        } else {
          router.push(`/auftraege?deleted_project=${encodeURIComponent(project.name)}`);
          return untilPageLeaves();
        }
      } catch {
        setError(PROJECT_DELETE_FAILED_MESSAGE);
      }
    });
  };

  const handleDeleteDialogOpenChange = (open: boolean) => {
    setShowDeleteDialog(open);
    if (!open) setError(null);
  };

  return {
    router,
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

export function ProjectActionsMenu({
  project,
  detailHref,
  clientName,
  jobs,
  onProjectUpdated,
  onProjectDeleted,
  onDeleteRequested,
}: ProjectActionsMenuProps) {
  const {
    router,
    showDeleteDialog,
    setShowDeleteDialog,
    showEditDialog,
    setShowEditDialog,
    isDeleting,
    error,
    handleDeleteDialogOpenChange,
    handleDelete,
  } = useProjectActionsMenuState({ project, onProjectDeleted, onDeleteRequested });

  return (
    <>
      <RowActionsMenu
        disabled={isDeleting}
        actions={rowMenuActions({
          openDetails: () => router.push(detailHref),
          openEdit: () => setShowEditDialog(true),
          openDelete: () => setShowDeleteDialog(true),
        })}
      />

      <AlertDialog open={showDeleteDialog} pending={isDeleting} onOpenChange={handleDeleteDialogOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projekt löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du das Projekt{' '}
              <span className="font-medium">
                {project.projectNumber ? `${project.projectNumber} – ` : ''}
                {project.name}
              </span>{' '}
              löschen möchtest? Die zugehörigen Aufträge bleiben erhalten, werden aber vom Projekt getrennt.
              Diese Aktion kann nicht rückgängig gemacht werden.
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

      <EditProjectDialog
        project={project}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        selectedClient={project.clientId ? { id: project.clientId, name: clientName } : null}
        jobs={jobs}
        onSuccess={onProjectUpdated}
      />
    </>
  );
}
