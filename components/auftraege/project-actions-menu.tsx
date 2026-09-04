'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, Loader2, Trash2, Pencil } from 'lucide-react';

import { ErrorText } from '@/components/ui/error-text';
import { RowActionsMenu } from '@/components/ui/row-actions-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { EditProjectDialog } from './edit-project-dialog';
import { deleteProject } from '@/lib/projects/actions';
import {
  type Client,
  type Job,
  type Project,
  type ProjectWithDetails,
} from '@/lib/jobs/types';

export const PROJECT_DELETE_FAILED_MESSAGE =
  'Das Projekt konnte nicht gelöscht werden.';

interface ProjectActionsMenuProps {
  project: ProjectWithDetails;
  detailHref: string;
  clients: Client[];
  jobs: Job[];
  onProjectUpdated?: (payload: {
    project: Project;
    selectedJobIds?: string[];
  }) => void | Promise<void>;
  onProjectDeleted?: (projectId: string) => void | Promise<void>;
  /**
   * Optimistic list mode (feedback canon): the confirm closes at once and the
   * list owns the delete — row removal, server call, rollback, banners.
   * `onProjectDeleted` is not called on that path.
   */
  onDeleteRequested?: (projectId: string) => void;
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (isDeleting) return;
    if (onDeleteRequested) {
      setShowDeleteDialog(false);
      onDeleteRequested(project.id);
      return;
    }
    setIsDeleting(true);
    setError(null);

    try {
      const result = await deleteProject(project.id);

      if (!result.success) {
        setError(PROJECT_DELETE_FAILED_MESSAGE);
        setIsDeleting(false);
        return;
      }

      setShowDeleteDialog(false);
      if (onProjectDeleted) {
        await onProjectDeleted(project.id);
      } else {
        router.push(`/auftraege?deleted_project=${encodeURIComponent(project.name)}`);
      }
    } catch {
      setError(PROJECT_DELETE_FAILED_MESSAGE);
      setIsDeleting(false);
    }
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
              löschen möchtest? Die zugehörigen Aufträge bleiben erhalten,
              werden aber vom Projekt getrennt. Diese Aktion kann nicht
              rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ErrorText>{error}</ErrorText>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Wird gelöscht...
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
