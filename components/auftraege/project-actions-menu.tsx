'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  ExternalLink,
  Trash2,
  ArrowRightLeft,
  Loader2,
  RotateCcw,
  Pencil,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
import { ParkConfirmationDialog } from './park-confirmation-dialog';
import { EditProjectDialog } from './edit-project-dialog';
import { updateProject, deleteProject, parkProject } from '@/lib/projects/actions';
import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  type Client,
  type Job,
  type Project,
  type ProjectStatus,
  type ProjectWithDetails,
} from '@/lib/jobs/types';

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
}

export function ProjectActionsMenu({
  project,
  detailHref,
  clients,
  jobs,
  onProjectUpdated,
  onProjectDeleted,
}: ProjectActionsMenuProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showParkDialog, setShowParkDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusOverride = async (newStatus: ProjectStatus | null) => {
    if (newStatus === 'geparkt') {
      setShowParkDialog(true);
      return;
    }
    if (isChangingStatus) return;
    setIsChangingStatus(true);

    const result = await updateProject(project.id, { statusOverride: newStatus });

    if (result.success) {
      if (onProjectUpdated) {
        await onProjectUpdated({ project: result.project });
      } else {
        router.refresh();
      }
    } else {
      console.error('Status override failed:', result.error);
    }

    setIsChangingStatus(false);
  };

  const handleParkConfirm = async () => {
    setIsChangingStatus(true);
    const result = await parkProject(project.id);
    if (result.success) {
      if (onProjectUpdated) {
        await onProjectUpdated({ project: result.project });
      } else {
        router.refresh();
      }
    } else {
      console.error('Park project failed:', result.error);
    }
    setIsChangingStatus(false);
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setError(null);

    const result = await deleteProject(project.id);

    if (result.success) {
      setShowDeleteDialog(false);
      if (onProjectDeleted) {
        await onProjectDeleted(project.id);
      } else {
        router.push(`/auftraege?deleted_project=${encodeURIComponent(project.name)}`);
      }
    } else {
      setError(result.error || 'Fehler beim Löschen des Projekts');
      setIsDeleting(false);
    }
  };

  const isLoading = isDeleting || isChangingStatus;

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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowRightLeft className="size-4" />
              Status überschreiben
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {project.statusOverride && (
                <>
                  <DropdownMenuItem onClick={() => handleStatusOverride(null)}>
                    <RotateCcw className="size-4" />
                    Automatisch (zurücksetzen)
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {PROJECT_STATUS_ORDER.filter((s) => s !== project.statusOverride).map(
                (status) => (
                  <DropdownMenuItem
                    key={status}
                    onClick={() => handleStatusOverride(status)}
                  >
                    {PROJECT_STATUS_LABELS[status]}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
          {error && <p className="text-sm text-destructive">{error}</p>}
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

      <ParkConfirmationDialog
        open={showParkDialog}
        onOpenChange={setShowParkDialog}
        variant="project"
        title={project.name}
        identifier={project.projectNumber ?? undefined}
        onConfirm={handleParkConfirm}
      />

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
