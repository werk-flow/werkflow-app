'use client';

import { useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { usePendingTask } from '@/hooks/use-server-action';
import { updateJob } from '@/lib/jobs/actions';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { updateProject } from '@/lib/projects/actions';
import type { JobWithDetails, Project } from '@/lib/jobs/types';
import { ClientAssignmentDialog } from '../shared/client-assignment-dialog';
import { projectNameOfOption } from '../forms/job-form-options';
import { ProjectAssignmentDialog } from './project-assignment-dialog';

type JobDetailRelationDialogsProps = {
  liveJob: JobWithDetails;
  parentProject: Pick<Project, 'id' | 'name' | 'projectNumber'> | undefined;
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

  // updateProject's and updateJob's responses render the route, so no refresh follows a save.
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
            // The customer card comes with the rendered route; only a removal is known here.
            applyLiveJobPatch({ ...result.job, ...(result.job.clientId ? {} : { client: null }) });
          }
        }
      } catch {
        setClientSaveError('Der Kunde konnte nicht gespeichert werden.');
        return;
      }
      setShowClientDialog(false);
    });
  };

  const handleProjectSave = async (chosenProject: JobEntityOption) => {
    setProjectSaveError(null);
    void runProjectUpdateTask(async () => {
      suppressRefreshRef.current = true;
      let result: Awaited<ReturnType<typeof updateJob>>;
      try {
        result = await updateJob(liveJob.id, { projectId: chosenProject.value });
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
            result.job.projectId === chosenProject.value
              ? {
                  id: chosenProject.value,
                  name: projectNameOfOption(chosenProject),
                  projectNumber: chosenProject.number ?? null,
                }
              : null,
        });
      }

      const nextJobNumber = result.success ? result.job.jobNumber : liveJob.jobNumber;
      // The dialog only opens for a job without a project and saves a selected one.
      if (!nextJobNumber || !chosenProject.number) {
        // updateJob's response already rendered the route.
        suppressRefreshRef.current = false;
        return;
      }

      router.replace(
        `/auftraege/projekt/${encodeURIComponent(chosenProject.number)}/${encodeURIComponent(nextJobNumber)}`,
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
        currentClient={liveJob.client}
        title={parentProject?.id ? 'Kunde zum Projekt hinzufügen' : 'Kunde zum Auftrag hinzufügen'}
        isSaving={isUpdatingClient}
        saveError={clientSaveError}
        onSave={handleClientSave}
      />

      <ProjectAssignmentDialog
        open={showProjectDialog}
        onOpenChange={(open) => {
          setShowProjectDialog(open);
          if (!open) setProjectSaveError(null);
        }}
        currentProjectId={liveJob.projectId}
        currentClientId={liveJob.clientId}
        title="Projekt zum Auftrag hinzufügen"
        isSaving={isUpdatingProject}
        saveError={projectSaveError}
        onSave={handleProjectSave}
      />
    </>
  );
}
