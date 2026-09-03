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
import { EditJobDialog } from './edit-job-dialog';
import { deleteJob } from '@/lib/jobs/actions';
import {
  JOB_DELETE_FAILED_MESSAGE,
  JOB_DELETE_HISTORY_MESSAGE,
} from '@/lib/jobs/messages';
import {
  getJobDisplayTitle,
  type Client,
  type Job,
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
  const displayTitle = getJobDisplayTitle(job);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        router.push(`/auftraege?deleted_job=${encodeURIComponent(displayTitle)}`);
      }
    } else {
      setError(
        result.error === 'planning_history_exists'
          ? JOB_DELETE_HISTORY_MESSAGE
          : JOB_DELETE_FAILED_MESSAGE
      );
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
            <AlertDialogTitle>Auftrag löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Bist du sicher, dass du den Auftrag{' '}
              <span className="font-medium">
                {job.jobNumber ? `${job.jobNumber} – ` : ''}
                {displayTitle}
              </span>{' '}
              löschen möchtest? Diese Aktion kann nicht rückgängig gemacht
              werden.
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
