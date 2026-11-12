'use client';

import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { DetailPageHeader } from '@/components/shared/detail-page-header';
import { type JobWithDetails, JOB_PRIORITY_LABELS } from '@/lib/jobs/types';
import { getJobStatusClass, getJobStatusLabel } from '../status-classes';
import { PRIORITY_CLASSES } from './job-detail-format';
import { lazyEditJobDialog } from './job-detail-content-dialogs';

type JobDetailHeaderProps = {
  liveJob: JobWithDetails;
  projectInfo: JobWithDetails['project'];
  displayTitle: string;
  isJobActive: boolean;
  isAdminOrManager: boolean;
  showEditDialog: boolean;
  handleEditDialogOpenChange: (open: boolean) => void;
  setShowDeleteDialog: (open: boolean) => void;
};

export function JobDetailHeader({
  liveJob,
  projectInfo,
  displayTitle,
  isJobActive,
  isAdminOrManager,
  showEditDialog,
  handleEditDialogOpenChange,
  setShowDeleteDialog,
}: JobDetailHeaderProps) {
  const breadcrumbs = projectInfo?.projectNumber
    ? [
        { label: 'Aufträge', href: '/auftraege' },
        {
          label: projectInfo.projectNumber,
          href: `/auftraege/projekt/${encodeURIComponent(projectInfo.projectNumber)}`,
        },
        { label: liveJob.jobNumber ?? 'Auftrag' },
      ]
    : [{ label: 'Aufträge', href: '/auftraege' }, { label: liveJob.jobNumber ?? 'Auftrag' }];

  return (
    <DetailPageHeader
      breadcrumbs={breadcrumbs}
      title={
        <span className="inline-flex items-start gap-1 overflow-visible">
          <span className="line-clamp-2 break-words">{displayTitle}</span>
          {isJobActive && (
            <span
              className="relative ml-1 mr-1 inline-flex h-3 w-3 shrink-0"
              title="Jemand arbeitet gerade an diesem Auftrag"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-success" />
            </span>
          )}
        </span>
      }
      badges={
        <>
          <Badge variant="secondary" className={getJobStatusClass(liveJob)}>
            {getJobStatusLabel(liveJob)}
          </Badge>
          <Badge variant="secondary" className={PRIORITY_CLASSES[liveJob.priority]}>
            {JOB_PRIORITY_LABELS[liveJob.priority]}
          </Badge>
        </>
      }
      actions={
        isAdminOrManager ? (
          <JobDetailActionsMenu
            showEditDialog={showEditDialog}
            handleEditDialogOpenChange={handleEditDialogOpenChange}
            setShowDeleteDialog={setShowDeleteDialog}
          />
        ) : undefined
      }
    />
  );
}

/** Admin and Büro's edit and delete menu. Opening it starts the edit form's download. */
function JobDetailActionsMenu({
  showEditDialog,
  handleEditDialogOpenChange,
  setShowDeleteDialog,
}: Pick<JobDetailHeaderProps, 'showEditDialog' | 'handleEditDialogOpenChange' | 'setShowDeleteDialog'>) {
  // The trigger shows a spinner while the edit form downloads.
  const editWaiting = lazyEditJobDialog.useWaiting(showEditDialog);
  // An item that opens a dialog keeps the menu from returning focus to its
  // trigger: that focus left the open dialog, and the dialog's focus trap took
  // it back with the field's whole value selected, so one keystroke replaced it.
  // A menu closed without a choice still returns focus to the trigger.
  const openedDialog = useRef(false);
  const openDialog = (open: () => void): void => {
    openedDialog.current = true;
    open();
  };

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) lazyEditJobDialog.preload();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Aktionen öffnen"
          pending={editWaiting}
        >
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!openedDialog.current) return;
          openedDialog.current = false;
          event.preventDefault();
        }}
      >
        <DropdownMenuItem onClick={() => openDialog(() => handleEditDialogOpenChange(true))}>
          <Pencil className="mr-2 size-4" />
          Bearbeiten
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => openDialog(() => setShowDeleteDialog(true))}
        >
          <Trash2 className="mr-2 size-4" />
          Auftrag löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
