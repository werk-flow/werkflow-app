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
import { EditProjectDialog } from '../forms/edit-project-dialog';
import { deleteProject } from '@/lib/projects/actions';
import { type Client, type Job, type Project, type ProjectWithDetails } from '@/lib/jobs/types';
import { Spinner } from '@/components/ui/spinner';

export const PROJECT_DELETE_FAILED_MESSAGE = 'Das Projekt konnte nicht gelöscht werden.';

interface ProjectActionsMenuProps {
  project: ProjectWithDetails;
  detailHref: string;
  clients: Client[];
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

export function ProjectActionsMenu({
  project,
  detailHref,
  clients,
  jobs,
  onProjectUpdated,
  onProjectDeleted,
  onDeleteRequested,
}: ProjectActionsMenuProps) {
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

      <EditProjectDialog
        project={project}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        clients={clients}
        jobs={jobs}
        onSuccess={onProjectUpdated}
      />
    </>
  );
}
