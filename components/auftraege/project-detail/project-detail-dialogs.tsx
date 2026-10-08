'use client';

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

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
import { CreateJobDialog } from '../forms/create-job-dialog';
import { EditProjectDialog } from '../forms/edit-project-dialog';
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
}: ProjectDetailDialogsProps) {
  const {
    showCreateJob,
    setShowCreateJob,
    showEditDialog,
    setShowEditDialog,
    dialogClients,
    dialogMembers,
    isLoadingDialogOptions,
    dialogOptionsError,
    setDialogOptionsRefreshKey,
  } = dialogState;

  return (
    <>
      <CreateJobDialog
        clients={dialogClients}
        members={dialogMembers}
        projects={[
          {
            ...liveProject,
            client: liveClient,
            jobCount: liveJobs.length,
            completedJobCount: completedCount,
            inProgressJobCount: inProgressCount,
            parkedJobCount: parkedCount,
          },
        ]}
        defaultProjectId={liveProject.id}
        defaultClientId={liveProject.clientId ?? undefined}
        readOnlyProject
        readOnlyClient
        optionsLoad={{
          // The error is shared by every project dialog; it applies here only while this list is missing.
          error: dialogClients.length === 0 || dialogMembers.length === 0 ? dialogOptionsError : null,
          retry: () => setDialogOptionsRefreshKey((value) => value + 1),
          isLoading: isLoadingDialogOptions,
        }}
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
        clients={dialogClients}
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
        liveProject={liveProject}
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
  liveProject,
  setLiveProject,
  dialogState,
}: Pick<ProjectDetailDialogsProps, 'project' | 'liveProject' | 'setLiveProject' | 'dialogState'>) {
  const {
    showClientDialog,
    setShowClientDialog,
    dialogClients,
    isLoadingDialogOptions,
    dialogOptionsError,
    setDialogOptionsRefreshKey,
  } = dialogState;
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
      clients={dialogClients}
      currentClientId={liveProject.clientId}
      title="Kunde zum Projekt hinzufügen"
      isSaving={isUpdatingClient}
      saveError={clientSaveError}
      optionsLoad={{
        error: dialogClients.length === 0 ? dialogOptionsError : null,
        retry: () => setDialogOptionsRefreshKey((value) => value + 1),
        isLoading: isLoadingDialogOptions,
      }}
      onSave={handleClientSave}
    />
  );
}

function ProjectDetailAssignJobsDialog({
  project,
  setLiveJobs,
  dialogState,
}: Pick<ProjectDetailDialogsProps, 'project' | 'setLiveJobs' | 'dialogState'>) {
  const {
    showAssignJobsDialog,
    setShowAssignJobsDialog,
    dialogAvailableJobs,
    setDialogAvailableJobs,
    isLoadingDialogOptions,
    dialogOptionsError,
    setDialogOptionsRefreshKey,
  } = dialogState;
  const { run: runAssignJobsTask, isPending: isAssigningJobs } = usePendingTask();
  const [assignJobsError, setAssignJobsError] = useState<string | null>(null);

  const assignableJobs = useMemo(
    () => dialogAvailableJobs.filter((job) => !job.projectId && job.status !== 'fertig'),
    [dialogAvailableJobs],
  );

  const handleAssignJobsSave = async (jobIds: string[]) => {
    void runAssignJobsTask(async () => {
      setAssignJobsError(null);
      const results = await Promise.allSettled(
        jobIds.map((jobId) => updateJob(jobId, { projectId: project.id })),
      );
      const assignedJobIds = jobIds.filter((_, index) => {
        const result = results[index];
        return result?.status === 'fulfilled' && result.value.success;
      });
      setLiveJobs((prev) => {
        const knownIds = new Set(prev.map((job) => job.id));
        const promotedJobs = dialogAvailableJobs
          .filter((job) => assignedJobIds.includes(job.id) && !knownIds.has(job.id))
          .map((job) => ({
            ...job,
            projectId: project.id,
            clientId: project.clientId ?? job.clientId,
          }));

        return [...prev, ...promotedJobs];
      });
      if (assignedJobIds.length !== jobIds.length) {
        setDialogAvailableJobs((previous) => previous.filter((job) => !assignedJobIds.includes(job.id)));
        setAssignJobsError('Einige Aufträge konnten nicht hinzugefügt werden. Bitte versuche es erneut.');
        return;
      }

      setShowAssignJobsDialog(false);
      setDialogAvailableJobs([]);
    });
  };

  return (
    <ProjectJobsAssignmentDialog
      open={showAssignJobsDialog}
      onOpenChange={(open) => {
        setShowAssignJobsDialog(open);
        if (!open) setAssignJobsError(null);
      }}
      jobs={assignableJobs}
      title="Aufträge zum Projekt hinzufügen"
      isSaving={isAssigningJobs}
      isLoading={isLoadingDialogOptions}
      loadError={dialogOptionsError}
      saveError={assignJobsError}
      onRetry={() => setDialogOptionsRefreshKey((value) => value + 1)}
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
