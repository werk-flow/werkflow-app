'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Loader2,
  Pencil,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MoreHorizontal className="size-4" />
            )}
            <span className="sr-only">Aktionen öffnen</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => router.push(detailHref)}>
            <ExternalLink className="size-4" />
            Details anzeigen
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
            <Pencil className="size-4" />
            Bearbeiten
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setShowDeleteDialog(true)}
          >
            <Trash2 className="size-4" />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
