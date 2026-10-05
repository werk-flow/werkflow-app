'use client';

import { useCallback } from 'react';

import type { useBanner } from '@/components/ui/banner';
import { useBusyIds } from '@/hooks/use-busy-id';
import type { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';
import type { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useSettleOnChange } from '@/hooks/use-settle-on-change';
import { deleteJob } from '@/lib/jobs/actions';
import { JOB_DELETE_FAILED_MESSAGE } from '@/lib/jobs/messages';
import type { Job, Project, ProjectWithDetails } from '@/lib/jobs/types';
import { deleteProject } from '@/lib/projects/actions';
import { describeJobDeleteError } from './job-actions-menu';
import { PROJECT_DELETE_FAILED_MESSAGE } from './project-actions-menu';
import type { useAuftraegeLocalUpdates } from './use-auftraege-local-updates';

type OptimisticListControls = ReturnType<typeof useOptimisticList>;

type AuftraegeRowActionsOptions = Pick<
  ReturnType<typeof useAuftraegeLocalUpdates>,
  | 'handleJobUpsert'
  | 'handleJobDelete'
  | 'handleProjectUpsert'
  | 'handleProjectDelete'
  | 'handleJobAssignmentsReplace'
> & {
  /** The server props; a change of either list settles the rows edited before it. */
  initialJobs: Job[];
  initialProjects: ProjectWithDetails[];
  setJobs: ReturnType<typeof useLiveAuftraegeData>['setJobs'];
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  removeJob: OptimisticListControls['remove'];
  rollbackJob: OptimisticListControls['rollback'];
  removeProject: OptimisticListControls['remove'];
  rollbackProject: OptimisticListControls['rollback'];
};

/** Optimistic delete and settle-after-edit for the rows of the Aufträge list. */
export function useAuftraegeRowActions({
  initialJobs,
  initialProjects,
  setJobs,
  showBanner,
  removeJob,
  rollbackJob,
  removeProject,
  rollbackProject,
  handleJobUpsert,
  handleJobDelete,
  handleProjectUpsert,
  handleProjectDelete,
  handleJobAssignmentsReplace,
}: AuftraegeRowActionsOptions) {
  const { busyIds: settlingIds, run: markSettling } = useBusyIds();
  const waitForJobsRefresh = useSettleOnChange(initialJobs);
  const waitForProjectsRefresh = useSettleOnChange(initialProjects);

  const handleJobDeleteRequested = useCallback(
    async (jobId: string) => {
      removeJob(jobId);
      try {
        const result = await deleteJob(jobId);
        if (!result.success) {
          rollbackJob(jobId);
          showBanner({ variant: 'error', message: describeJobDeleteError(result.error) });
          return;
        }
        handleJobDelete(jobId);
        showBanner({ variant: 'success', message: 'Auftrag gelöscht.' });
      } catch {
        rollbackJob(jobId);
        showBanner({ variant: 'error', message: JOB_DELETE_FAILED_MESSAGE });
      }
    },
    [handleJobDelete, removeJob, rollbackJob, showBanner],
  );

  const handleProjectDeleteRequested = useCallback(
    async (projectId: string) => {
      removeProject(projectId);
      try {
        const result = await deleteProject(projectId);
        if (!result.success) {
          rollbackProject(projectId);
          showBanner({ variant: 'error', message: PROJECT_DELETE_FAILED_MESSAGE });
          return;
        }
        handleProjectDelete(projectId);
        showBanner({ variant: 'success', message: 'Projekt gelöscht.' });
      } catch {
        rollbackProject(projectId);
        showBanner({ variant: 'error', message: PROJECT_DELETE_FAILED_MESSAGE });
      }
    },
    [handleProjectDelete, removeProject, rollbackProject, showBanner],
  );

  const handleJobEdited = useCallback(
    ({ job, selectedEmployeeIds }: { job: Job; selectedEmployeeIds?: string[] }) => {
      handleJobUpsert(job);
      if (selectedEmployeeIds) {
        handleJobAssignmentsReplace(job.id, selectedEmployeeIds);
      }
      void markSettling(job.id, waitForJobsRefresh);
    },
    [handleJobAssignmentsReplace, handleJobUpsert, markSettling, waitForJobsRefresh],
  );

  const handleProjectEdited = useCallback(
    ({ project, selectedJobIds }: { project: Project; selectedJobIds?: string[] }) => {
      handleProjectUpsert(project);
      void markSettling(project.id, waitForProjectsRefresh);
      if (!selectedJobIds) return;
      setJobs((prev) =>
        prev.map((job) => {
          if (selectedJobIds.includes(job.id)) {
            return {
              ...job,
              projectId: project.id,
              clientId: project.clientId ?? job.clientId,
            };
          }

          if (job.projectId === project.id) {
            return {
              ...job,
              projectId: null,
            };
          }

          return job;
        }),
      );
    },
    [handleProjectUpsert, markSettling, setJobs, waitForProjectsRefresh],
  );

  return {
    settlingIds,
    handleJobDeleteRequested,
    handleProjectDeleteRequested,
    handleJobEdited,
    handleProjectEdited,
  };
}
