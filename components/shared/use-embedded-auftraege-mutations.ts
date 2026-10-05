'use client';

import { useCallback, type Dispatch, type SetStateAction } from 'react';

import type { Job, Project } from '@/lib/jobs/types';

/** Applies created, edited and deleted jobs and projects to the live list state. */
export function useEmbeddedAuftraegeMutations(
  setJobs: Dispatch<SetStateAction<Job[]>>,
  setRawProjects: Dispatch<SetStateAction<Project[]>>,
  setJobAssignmentMap: Dispatch<SetStateAction<Record<string, string[]>>>,
) {
  const handleJobUpsert = useCallback(
    (job: Job) => {
      setJobs((prev) => {
        const next = prev.filter((entry) => entry.id !== job.id);
        next.push(job);
        return next;
      });
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
      setRawProjects((prev) => {
        const next = prev.filter((entry) => entry.id !== project.id);
        next.push(project);
        return next;
      });
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

      setJobs((prev) =>
        prev.map((job) =>
          linkedJobIds.includes(job.id)
            ? {
                ...job,
                projectId: project.id,
                clientId: project.clientId ?? job.clientId,
              }
            : job,
        ),
      );
    },
    [handleProjectUpsert, setJobs],
  );

  const handleJobEdited = useCallback(
    ({ job, selectedEmployeeIds }: { job: Job; selectedEmployeeIds?: string[] }) => {
      handleJobUpsert(job);
      if (selectedEmployeeIds) {
        handleJobAssignmentsReplace(job.id, selectedEmployeeIds);
      }
    },
    [handleJobAssignmentsReplace, handleJobUpsert],
  );

  const handleProjectEdited = useCallback(
    ({ project, selectedJobIds }: { project: Project; selectedJobIds?: string[] }) => {
      handleProjectUpsert(project);
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
    [handleProjectUpsert, setJobs],
  );

  return {
    handleJobDelete,
    handleProjectDelete,
    handleJobCreated,
    handleProjectCreated,
    handleJobEdited,
    handleProjectEdited,
  };
}
