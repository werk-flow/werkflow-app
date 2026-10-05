'use client';

import { useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { usePendingTask } from '@/hooks/use-server-action';
import { updateJob } from '@/lib/jobs/actions';
import { updateProject } from '@/lib/projects/actions';
import type { Client, JobWithDetails, Project, ProjectWithDetails } from '@/lib/jobs/types';
import { ClientAssignmentDialog } from '../shared/client-assignment-dialog';
import { ProjectAssignmentDialog } from './project-assignment-dialog';

type JobDetailRelationDialogsProps = {
  liveJob: JobWithDetails;
  parentProject: Pick<Project, 'id' | 'name' | 'projectNumber'> | undefined;
  clients: Client[];
  projects: ProjectWithDetails[];
  dialogClients: Client[];
  dialogProjects: ProjectWithDetails[];
  isLoadingDialogOptions: boolean;
  dialogOptionsError: string | null;
  retryDialogOptions: () => void;
  showClientDialog: boolean;
  setShowClientDialog: (open: boolean) => void;
  showProjectDialog: boolean;
  setShowProjectDialog: (open: boolean) => void;
  applyLiveJobPatch: (updatedJob: Partial<JobWithDetails>) => void;
  // Owned by the page: true while a URL-changing project move is mid-flight.
  suppressRefreshRef: RefObject<boolean>;
};

/** The two dialogs that link the job to a customer or a project, with their saves. */
export function JobDetailRelationDialogs({
  liveJob,
  parentProject,
  clients,
  projects,
  dialogClients,
  dialogProjects,
  isLoadingDialogOptions,
  dialogOptionsError,
  retryDialogOptions,
  showClientDialog,
  setShowClientDialog,
  showProjectDialog,
  setShowProjectDialog,
  applyLiveJobPatch,
  suppressRefreshRef,
}: JobDetailRelationDialogsProps) {
  const router = useRouter();
  // Dialog-scoped failures: each stays visible inside its open dialog.
  const [clientSaveError, setClientSaveError] = useState<string | null>(null);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const { run: runClientUpdateTask, isPending: isUpdatingClient } = usePendingTask();
  const { run: runProjectUpdateTask, isPending: isUpdatingProject } = usePendingTask();

  const handleClientSave = async (clientId: string) => {
    setClientSaveError(null);
    void runClientUpdateTask(async () => {
      // The dialog stays open with the failure on any rejected or thrown save.
      try {
        if (parentProject?.id) {
          const result = await updateProject(parentProject.id, { clientId });
          if (!result.success) {
            setClientSaveError('Der Kunde konnte nicht gespeichert werden.');
            return;
          }
        } else {
          const result = await updateJob(liveJob.id, { clientId });
          if (!result.success && result.error !== 'no_changes') {
            setClientSaveError('Der Kunde konnte nicht gespeichert werden.');
            return;
          }
          if (result.success) {
            applyLiveJobPatch({
              ...result.job,
              clientId: result.job.clientId,
              client: result.job.clientId
                ? (clients.find((client) => client.id === result.job.clientId) ?? null)
                : null,
            });
          }
        }
      } catch {
        setClientSaveError('Der Kunde konnte nicht gespeichert werden.');
        return;
      }
      setShowClientDialog(false);
      if (parentProject?.id) {
        router.refresh();
      }
    });
  };

  const handleProjectSave = async (projectId: string) => {
    setProjectSaveError(null);
    void runProjectUpdateTask(async () => {
      suppressRefreshRef.current = true;
      let result: Awaited<ReturnType<typeof updateJob>>;
      try {
        result = await updateJob(liveJob.id, { projectId });
      } catch {
        suppressRefreshRef.current = false;
        setProjectSaveError('Das Projekt konnte nicht gespeichert werden.');
        return;
      }
      if (!result.success && result.error !== 'no_changes') {
        // The dialog stays open and the failure is visible (no silent close).
        suppressRefreshRef.current = false;
        setProjectSaveError('Das Projekt konnte nicht gespeichert werden.');
        return;
      }
      setShowProjectDialog(false);

      if (result.success) {
        applyLiveJobPatch({
          ...result.job,
          project:
            result.job.projectId && result.job.projectId !== liveJob.projectId
              ? (() => {
                  const nextProject = dialogProjects.find((project) => project.id === result.job.projectId);
                  return nextProject
                    ? {
                        id: nextProject.id,
                        name: nextProject.name,
                        projectNumber: nextProject.projectNumber ?? null,
                      }
                    : null;
                })()
              : result.job.projectId
                ? liveJob.project
                : null,
        });
      }

      const nextJobNumber = result.success ? result.job.jobNumber : liveJob.jobNumber;
      if (!nextJobNumber) {
        suppressRefreshRef.current = false;
        return;
      }

      // The dialog only opens for a job without a project and saves a selected one.
      const nextProject = projects.find((entry) => entry.id === projectId);
      if (!nextProject?.projectNumber) {
        suppressRefreshRef.current = false;
        router.refresh();
        return;
      }

      router.replace(
        `/auftraege/projekt/${encodeURIComponent(nextProject.projectNumber)}/${encodeURIComponent(nextJobNumber)}`,
      );
    });
  };

  return (
    <>
      <ClientAssignmentDialog
        open={showClientDialog}
        onOpenChange={(open) => {
          setShowClientDialog(open);
          if (!open) setClientSaveError(null);
        }}
        clients={dialogClients}
        currentClientId={liveJob.clientId}
        title={parentProject?.id ? 'Kunde zum Projekt hinzufügen' : 'Kunde zum Auftrag hinzufügen'}
        isSaving={isUpdatingClient}
        saveError={clientSaveError}
        optionsLoad={{
          error: dialogOptionsError,
          retry: retryDialogOptions,
          isLoading: isLoadingDialogOptions,
        }}
        onSave={handleClientSave}
      />

      <ProjectAssignmentDialog
        open={showProjectDialog}
        onOpenChange={(open) => {
          setShowProjectDialog(open);
          if (!open) setProjectSaveError(null);
        }}
        projects={dialogProjects}
        currentProjectId={liveJob.projectId}
        currentClientId={liveJob.clientId}
        title="Projekt zum Auftrag hinzufügen"
        isSaving={isUpdatingProject}
        saveError={projectSaveError}
        optionsLoad={{
          error: dialogOptionsError,
          retry: retryDialogOptions,
          isLoading: isLoadingDialogOptions,
        }}
        onSave={handleProjectSave}
      />
    </>
  );
}
