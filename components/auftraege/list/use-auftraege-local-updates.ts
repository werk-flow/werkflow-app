'use client';

import { useCallback } from 'react';

import type { useLiveAuftraegeData } from '@/hooks/use-live-auftraege-data';
import type { Job, Project } from '@/lib/jobs/types';

type AuftraegeLocalUpdatesOptions = Pick<
  ReturnType<typeof useLiveAuftraegeData>,
  'setJobs' | 'setRawProjects' | 'setJobAssignmentMap'
>;

/** The list without the entry of the same id, with the given entry at its end. */
function withEntryReplaced<T extends { id: string }>(prev: T[], entry: T): T[] {
  const next = prev.filter((candidate) => candidate.id !== entry.id);
  next.push(entry);
  return next;
}

/** The jobs with the linked ones moved into the new project and onto its customer. */
function withJobsLinkedToProject(prev: Job[], project: Project, linkedJobIds: string[]): Job[] {
  return prev.map((job) =>
    linkedJobIds.includes(job.id)
      ? {
          ...job,
          projectId: project.id,
          clientId: project.clientId ?? job.clientId,
        }
      : job,
  );
}

/** Echoes a confirmed server result into the client-owned jobs, projects and assignments. */
export function useAuftraegeLocalUpdates({
  setJobs,
  setRawProjects,
  setJobAssignmentMap,
}: AuftraegeLocalUpdatesOptions) {
  const handleJobUpsert = useCallback(
    (job: Job) => {
      setJobs((prev) => withEntryReplaced(prev, job));
    },
    [setJobs],
  );

  const handleJobDelete = useCallback(
    (jobId: string) => {
      setJobs((prev) => prev.filter((entry) => entry.id !== jobId));
      setJobAssignmentMap((prev) => {
        if (!prev[jobId]) return prev;
        const next = { ...prev };
        delete next[jobId];
        return next;
      });
    },
    [setJobAssignmentMap, setJobs],
  );

  const handleProjectUpsert = useCallback(
    (project: Project) => {
      setRawProjects((prev) => withEntryReplaced(prev, project));
    },
    [setRawProjects],
  );

  const handleProjectDelete = useCallback(
    (projectId: string) => {
      setRawProjects((prev) => prev.filter((entry) => entry.id !== projectId));
      setJobs((prev) => prev.map((job) => (job.projectId === projectId ? { ...job, projectId: null } : job)));
    },
    [setJobs, setRawProjects],
  );

  const handleJobAssignmentsReplace = useCallback(
    (jobId: string, userIds: string[]) => {
      setJobAssignmentMap((prev) => ({
        ...prev,
        [jobId]: userIds,
      }));
    },
    [setJobAssignmentMap],
  );

  const handleJobCreated = useCallback(
    ({ job, assignedUserIds }: { job: Job; assignedUserIds: string[] }) => {
      handleJobUpsert(job);
      handleJobAssignmentsReplace(job.id, assignedUserIds);
    },
    [handleJobAssignmentsReplace, handleJobUpsert],
  );

  const handleProjectCreated = useCallback(
    ({ project, linkedJobIds }: { project: Project; linkedJobIds: string[] }) => {
      handleProjectUpsert(project);
      if (linkedJobIds.length === 0) return;

      setJobs((prev) => withJobsLinkedToProject(prev, project, linkedJobIds));
    },
    [handleProjectUpsert, setJobs],
  );

  return {
    handleJobUpsert,
    handleJobDelete,
    handleProjectUpsert,
    handleProjectDelete,
    handleJobAssignmentsReplace,
    handleJobCreated,
    handleProjectCreated,
  };
}
