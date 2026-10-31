'use client';

import { useState, type ReactNode, type RefObject } from 'react';
import type { JobWithDetails, Project } from '@/lib/jobs/types';
import { QualificationWarningDialog } from '../shared/qualification-warning-dialog';
import { EditJobDialog } from '../forms/edit-job-dialog';
import { knownProjectOption } from '../forms/job-form-options';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { JobDetailAssignDialog } from './job-detail-assign-dialog-sections';
import { JobDetailDeleteDialog } from './job-detail-delete-dialog';
import { JobDetailRelationDialogs } from './job-detail-relation-dialogs';
import type { JobDetailAssignments } from './use-job-detail-assignments';

/** Which of the job page's dialogs is open. */
export function useJobDetailDialogVisibility() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  // No refresh on close: updateJob's response renders the route, and a
  // Realtime refresh deferred while the dialog was open runs once it closes.
  const handleEditDialogOpenChange = (open: boolean) => setShowEditDialog(open);

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    showEditDialog,
    showAssignDialog,
    setShowAssignDialog,
    showClientDialog,
    setShowClientDialog,
    showProjectDialog,
    setShowProjectDialog,
    handleEditDialogOpenChange,
  };
}

type JobDetailContentDialogsProps = {
  dialogs: ReturnType<typeof useJobDetailDialogVisibility>;
  liveJob: JobWithDetails;
  parentProject: Pick<Project, 'id' | 'name' | 'projectNumber'> | undefined;
  projectInfo: Pick<Project, 'id' | 'name' | 'projectNumber'> | null | undefined;
  displayTitle: string;
  members: OrgMemberOption[];
  assignment: JobDetailAssignments;
  applyLiveJobPatch: (updatedJob: Partial<JobWithDetails>) => void;
  isDeletingRef: RefObject<boolean>;
  suppressRefreshRef: RefObject<boolean>;
  inlineEditWarningDialog: ReactNode;
};

/** The job page's dialogs: delete, assign, customer and project link, edit and the qualification warnings. */
export function JobDetailContentDialogs({
  dialogs,
  liveJob,
  parentProject,
  projectInfo,
  displayTitle,
  members,
  assignment,
  applyLiveJobPatch,
  isDeletingRef,
  suppressRefreshRef,
  inlineEditWarningDialog,
}: JobDetailContentDialogsProps) {
  return (
    <>
      {/* Delete Dialog */}
      <JobDetailDeleteDialog
        open={dialogs.showDeleteDialog}
        setShowDeleteDialog={dialogs.setShowDeleteDialog}
        jobId={liveJob.id}
        displayTitle={displayTitle}
        projectNumber={projectInfo?.projectNumber}
        isDeletingRef={isDeletingRef}
        suppressRefreshRef={suppressRefreshRef}
      />

      {/* Assign Employee Dialog */}
      <JobDetailAssignDialog
        open={dialogs.showAssignDialog}
        setShowAssignDialog={dialogs.setShowAssignDialog}
        assignment={assignment}
        members={members}
        assessedForDate={liveJob.plannedDate}
      />

      <JobDetailRelationDialogs
        liveJob={liveJob}
        parentProject={parentProject}
        showClientDialog={dialogs.showClientDialog}
        setShowClientDialog={dialogs.setShowClientDialog}
        showProjectDialog={dialogs.showProjectDialog}
        setShowProjectDialog={dialogs.setShowProjectDialog}
        applyLiveJobPatch={applyLiveJobPatch}
        suppressRefreshRef={suppressRefreshRef}
      />

      <EditJobDialog
        job={liveJob}
        open={dialogs.showEditDialog}
        onOpenChange={dialogs.handleEditDialogOpenChange}
        selectedClient={liveJob.client}
        members={members}
        knownProject={
          projectInfo && liveJob.projectId === projectInfo.id
            ? knownProjectOption({ ...projectInfo, clientId: liveJob.clientId }, liveJob.client?.name ?? null)
            : undefined
        }
        onSuccess={assignment.handleJobEdited}
      />

      <QualificationWarningDialog
        evaluation={assignment.qualificationWarning}
        isSubmitting={assignment.isAssigning || assignment.isQualificationOverrideSaving}
        error={assignment.qualificationOverrideError}
        onCancel={assignment.cancelQualificationWarning}
        onConfirm={assignment.handleQualificationOverride}
      />
      {inlineEditWarningDialog}
    </>
  );
}
