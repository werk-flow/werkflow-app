'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MoreHorizontal,
  ExternalLink,
  Trash2,
  ArrowRightLeft,
  Loader2,
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
import { EditJobDialog } from './edit-job-dialog';
import { deleteJob, updateJobStatus } from '@/lib/jobs/actions';
import {
  JOB_STATUS_LABELS,
  JOB_STATUS_ORDER,
  type Client,
  type Job,
  type JobStatus,
  type ProjectWithDetails,
} from '@/lib/jobs/types';
import type { OrgMemberOption } from './employee-multi-select';

interface JobActionsMenuProps {
  job: Job;
  detailHref: string;
  clients: Client[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  onJobUpdated?: (payload: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => void | Promise<void>;
  onJobDeleted?: (jobId: string) => void | Promise<void>;
}

export function JobActionsMenu({
  job,
  detailHref,
  clients,
  members,
  projects,
  onJobUpdated,
  onJobDeleted,
}: JobActionsMenuProps) {
  const router = useRouter();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showParkDialog, setShowParkDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStatusChange = async (newStatus: JobStatus) => {
    if (isChangingStatus) return;
    if (newStatus === 'geparkt') {
      setShowParkDialog(true);
      return;
    }
    setIsChangingStatus(true);

    const result = await updateJobStatus(job.id, newStatus);

    if (result.success) {
      if (onJobUpdated) {
        await onJobUpdated({
          job: result.job,
        });
      } else {
        router.refresh();
      }
    } else {
      console.error('Status change failed:', result.error);
    }

    setIsChangingStatus(false);
  };

  const handleParkConfirm = async () => {
    setIsChangingStatus(true);
    const result = await updateJobStatus(job.id, 'geparkt');
    if (result.success) {
      if (onJobUpdated) {
        await onJobUpdated({
          job: result.job,
        });
      } else {
        router.refresh();
      }
    } else {
      console.error('Park failed:', result.error);
    }
    setIsChangingStatus(false);
  };

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    setError(null);

    const result = await deleteJob(job.id);

    if (result.success) {
      setShowDeleteDialog(false);
      if (onJobDeleted) {
        await onJobDeleted(job.id);
      } else {
        router.push(`/auftraege?deleted_job=${encodeURIComponent(job.title)}`);
      }
    } else {
      setError(result.error || 'Fehler beim Löschen des Auftrags');
      setIsDeleting(false);
    }
  };

  const isLoading = isDeleting || isChangingStatus;
  const availableStatuses = JOB_STATUS_ORDER.filter((s) => s !== job.status);

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
              Status ändern
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {availableStatuses.map((status) => (
                <DropdownMenuItem
                  key={status}
                  onClick={() => handleStatusChange(status)}
                >
                  {JOB_STATUS_LABELS[status]}
                </DropdownMenuItem>
              ))}
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
            <AlertDialogTitle>Auftrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du den Auftrag{' '}
              <span className="font-medium">
                {job.jobNumber ? `${job.jobNumber} – ` : ''}
                {job.title}
              </span>{' '}
              löschen möchtest? Diese Aktion kann nicht rückgängig gemacht
              werden.
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
        variant="job"
        title={job.title}
        identifier={job.jobNumber ?? undefined}
        onConfirm={handleParkConfirm}
      />

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
