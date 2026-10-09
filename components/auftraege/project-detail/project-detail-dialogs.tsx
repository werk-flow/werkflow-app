'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';

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
import { ErrorText } from '@/components/ui/error-text';
import { usePendingTask } from '@/hooks/use-server-action';
import { updateJob } from '@/lib/jobs/actions';
import type { Client, Job, Project } from '@/lib/jobs/types';
import { updateProject, deleteProject } from '@/lib/projects/actions';
import { loadDocument } from '@/lib/navigation/document-load';
import { ClientAssignmentDialog } from '../shared/client-assignment-dialog';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import { CreateJobDialog } from '../forms/create-job-dialog';
import { EditProjectDialog } from '../forms/edit-project-dialog';
import { knownProjectOption } from '../forms/job-form-options';
import { ProjectJobsAssignmentDialog } from './project-jobs-assignment-dialog';
import type { ProjectDetailDialogState } from './use-project-detail-dialog-state';
import { Spinner } from '@/components/ui/spinner';

type ProjectDetailDialogsProps = {
  project: Project;
  liveProject: Project;
  liveClient: Client | null;
  liveJobs: Job[];
  completedCount: number;
  inProgressCount: number;
  parkedCount: number;
  setLiveProject: Dispatch<SetStateAction<Project>>;
  setLiveJobs: Dispatch<SetStateAction<Job[]>>;
  dialogState: ProjectDetailDialogState;
  members: OrgMemberOption[];
};

export function ProjectDetailDialogs({
  project,
  liveProject,
  liveClient,
  liveJobs,
  completedCount,
  inProgressCount,
  parkedCount,
  setLiveProject,
  setLiveJobs,
  dialogState,
  members,
}: ProjectDetailDialogsProps) {
  const { showCreateJob, setShowCreateJob, showEditDialog, setShowEditDialog } = dialogState;

  return (
    <>
      <CreateJobDialog
        members={members}
        defaultProject={knownProjectOption(liveProject, liveClient?.name ?? null)}
        defaultClient={liveClient ?? undefined}
        readOnlyProject
        readOnlyClient
        open={showCreateJob}
        onOpenChange={setShowCreateJob}
        onJobCreated={({ job }) => {
          setShowCreateJob(false);
          setLiveJobs((prev) => {
            const next = prev.filter((entry) => entry.id !== job.id);
            next.push(job);
            return next;
          });
        }}
      />

      <EditProjectDialog
        project={{
          ...liveProject,
          client: liveClient,
          jobCount: liveJobs.length,
          completedJobCount: completedCount,
          inProgressJobCount: inProgressCount,
          parkedJobCount: parkedCount,
        }}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        selectedClient={liveClient}
        jobs={liveJobs}
        onSuccess={({ project: nextProject, selectedJobIds }) => {
          setShowEditDialog(false);
          setLiveProject(nextProject);
          if (!selectedJobIds) return;
          setLiveJobs((prev) => {
            const selectedIds = new Set(selectedJobIds);
            return prev
              .filter((job) => selectedIds.has(job.id))
              .map((job) => ({
                ...job,
                projectId: nextProject.id,
                clientId: nextProject.clientId ?? job.clientId,
              }));
          });
        }}
      />

      <ProjectDetailClientDialog
        project={project}
        liveClient={liveClient}
        setLiveProject={setLiveProject}
        dialogState={dialogState}
      />

      <ProjectDetailAssignJobsDialog project={project} setLiveJobs={setLiveJobs} dialogState={dialogState} />

      <ProjectDetailDeleteDialog
        project={project}
        showDeleteDialog={dialogState.showDeleteDialog}
        setShowDeleteDialog={dialogState.setShowDeleteDialog}
      />
    </>
  );
}

function ProjectDetailClientDialog({
  project,
  liveClient,
  setLiveProject,
  dialogState,
}: Pick<ProjectDetailDialogsProps, 'project' | 'liveClient' | 'setLiveProject' | 'dialogState'>) {
  const { showClientDialog, setShowClientDialog } = dialogState;
  const [clientSaveError, setClientSaveError] = useState<string | null>(null);
  const { run: runClientUpdateTask, isPending: isUpdatingClient } = usePendingTask();

  const handleClientSave = async (clientId: string) => {
    setClientSaveError(null);
    void runClientUpdateTask(async () => {
      const result = await updateProject(project.id, {
        clientId,
      }).catch(() => null);
      if (!result?.success) {
        // The dialog stays open on failure (no silent close-and-drop).
        setClientSaveError('Der Kunde konnte nicht gespeichert werden.');
        return;
      }
      setShowClientDialog(false);
      setLiveProject(result.project);
    });
  };

  return (
    <ClientAssignmentDialog
      open={showClientDialog}
      onOpenChange={(open) => {
        setShowClientDialog(open);
        if (!open) setClientSaveError(null);
      }}
      currentClient={liveClient}
      title="Kunde zum Projekt hinzufügen"
      isSaving={isUpdatingClient}
      saveError={clientSaveError}
      onSave={handleClientSave}
    />
  );
}

function ProjectDetailAssignJobsDialog({
  project,
  setLiveJobs,
  dialogState,
}: Pick<ProjectDetailDialogsProps, 'project' | 'setLiveJobs' | 'dialogState'>) {
  const { showAssignJobsDialog, setShowAssignJobsDialog } = dialogState;
  const { run: runAssignJobsTask, isPending: isAssigningJobs } = usePendingTask();
  const [assignJobsError, setAssignJobsError] = useState<string | null>(null);

  const handleAssignJobsSave = async (jobIds: string[]): Promise<string[]> => {
    let assignedJobIds: string[] = [];
    await runAssignJobsTask(async () => {
      setAssignJobsError(null);
      const results = await Promise.allSettled(
        jobIds.map((jobId) => updateJob(jobId, { projectId: project.id })),
      );
      // Each saved link returns its job; those rows join the project's list.
      const assignedJobs = results.flatMap((result) =>
        result.status === 'fulfilled' && result.value.success ? [result.value.job] : [],
      );
      assignedJobIds = assignedJobs.map((job) => job.id);
      setLiveJobs((prev) => {
        const assignedIds = new Set(assignedJobIds);
        return [...prev.filter((job) => !assignedIds.has(job.id)), ...assignedJobs];
      });
      if (assignedJobs.length !== jobIds.length) {
        setAssignJobsError('Einige Aufträge konnten nicht hinzugefügt werden. Bitte versuche es erneut.');
        return;
      }

      setShowAssignJobsDialog(false);
    });
    return assignedJobIds;
  };

  return (
    <ProjectJobsAssignmentDialog
      open={showAssignJobsDialog}
      onOpenChange={(open) => {
        setShowAssignJobsDialog(open);
        if (!open) setAssignJobsError(null);
      }}
      title="Aufträge zum Projekt hinzufügen"
      isSaving={isAssigningJobs}
      saveError={assignJobsError}
      onSave={handleAssignJobsSave}
    />
  );
}

function ProjectDetailDeleteDialog({
  project,
  showDeleteDialog,
  setShowDeleteDialog,
}: {
  project: Project;
  showDeleteDialog: boolean;
  setShowDeleteDialog: (open: boolean) => void;
}) {
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { run: runDeleteTask, isPending: isDeleting } = usePendingTask();

  const handleDelete = () => {
    setDeleteError(null);
    void runDeleteTask(async () => {
      const result = await deleteProject(project.id).catch(() => null);
      if (result?.success) {
        // Full document load: see the deletion-stall note in components/kunden/use-client-deletion.ts.
        loadDocument(`/auftraege?deleted_project=${encodeURIComponent(project.name)}`);
        return;
      }
      setDeleteError('Das Projekt konnte nicht gelöscht werden.');
    });
  };

  return (
    <AlertDialog
      open={showDeleteDialog}
      pending={isDeleting}
      onOpenChange={(open) => {
        setShowDeleteDialog(open);
        if (!open) setDeleteError(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Projekt löschen?</AlertDialogTitle>
          <AlertDialogDescription>
            Möchtest du das Projekt &ldquo;{project.name}&rdquo; wirklich löschen? Alle zugehörigen Aufträge
            werden nicht gelöscht, aber ihre Projektzuordnung wird entfernt.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{deleteError}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            variant="destructive"
          >
            {isDeleting && <Spinner className="mr-2" />}
            Löschen
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
