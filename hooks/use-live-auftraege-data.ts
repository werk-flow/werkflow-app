'use client';

import { useMemo, useState } from 'react';

import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import { type Job, type Project, type ProjectWithDetails } from '@/lib/jobs/types';

type JobAssignmentMap = Record<string, string[]>;

type UseLiveAuftraegeDataArgs = {
  initialJobs: Job[];
  initialProjects: ProjectWithDetails[];
  initialJobAssignmentMap: JobAssignmentMap;
  preserveProjectCounts?: boolean;
};

function stripProjectDetails(project: ProjectWithDetails): Project {
  return {
    id: project.id,
    organizationId: project.organizationId,
    clientId: project.clientId,
    name: project.name,
    description: project.description,
    projectNumber: project.projectNumber,
    statusOverride: project.statusOverride,
    executionStateOverride: project.executionStateOverride,
    executionVersion: project.executionVersion,
    executionOverrideReason: project.executionOverrideReason,
    plannedStartDate: project.plannedStartDate,
    plannedEndDate: project.plannedEndDate,
    siteId: project.siteId,
    contactId: project.contactId,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function deriveProjects(rawProjects: Project[], jobs: Job[]): ProjectWithDetails[] {
  const countsByProject = new Map<
    string,
    {
      total: number;
      completed: number;
      inProgress: number;
      parked: number;
    }
  >();

  for (const job of jobs) {
    if (!job.projectId) continue;
    const counts = countsByProject.get(job.projectId) ?? {
      total: 0,
      completed: 0,
      inProgress: 0,
      parked: 0,
    };

    counts.total += 1;
    if (job.status === 'fertig') counts.completed += 1;
    if (job.status === 'in_bearbeitung') counts.inProgress += 1;
    if (job.status === 'geparkt') counts.parked += 1;

    countsByProject.set(job.projectId, counts);
  }

  return rawProjects.map((project) => {
    const counts = countsByProject.get(project.id) ?? {
      total: 0,
      completed: 0,
      inProgress: 0,
      parked: 0,
    };

    return {
      ...project,
      // No list view prints this object; the customer name comes from the client map.
      client: null,
      jobCount: counts.total,
      completedJobCount: counts.completed,
      inProgressJobCount: counts.inProgress,
      parkedJobCount: counts.parked,
    };
  });
}

export function useLiveAuftraegeData({
  initialJobs,
  initialProjects,
  initialJobAssignmentMap,
  preserveProjectCounts = false,
}: UseLiveAuftraegeDataArgs) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [rawProjects, setRawProjects] = useState<Project[]>(() => initialProjects.map(stripProjectDetails));
  const [jobAssignmentMap, setJobAssignmentMap] = useState<JobAssignmentMap>(initialJobAssignmentMap);

  // Server props are the authority for this list: every Realtime change
  // triggers a debounced route refresh, and the render below adopts the fresh
  // props. The setters remain for the caller's own-action optimistic echoes
  // (D4: a user's own action reflects instantly).
  useRealtimeRouterRefresh({
    tables: ['jobs', 'projects', 'job_assignments'],
  });

  // Adopted during render, never in a mount effect: inside a hydrated Suspense
  // boundary that effect runs at idle priority, its update starves behind a
  // pending route transition, and React then rebases every later functional
  // update into a new array on each render, which the optimistic list's
  // effect turns into an endless commit loop.
  const [adoptedProps, setAdoptedProps] = useState({
    initialJobs,
    initialProjects,
    initialJobAssignmentMap,
  });
  const jobsChanged = initialJobs !== adoptedProps.initialJobs;
  const projectsChanged = initialProjects !== adoptedProps.initialProjects;
  const assignmentsChanged = initialJobAssignmentMap !== adoptedProps.initialJobAssignmentMap;
  if (jobsChanged || projectsChanged || assignmentsChanged) {
    setAdoptedProps({ initialJobs, initialProjects, initialJobAssignmentMap });
    if (jobsChanged) setJobs(initialJobs);
    if (projectsChanged) setRawProjects(initialProjects.map(stripProjectDetails));
    if (assignmentsChanged) setJobAssignmentMap(initialJobAssignmentMap);
  }

  const projects = useMemo(
    () =>
      preserveProjectCounts
        ? rawProjects.map((project) => ({
            ...project,
            ...(initialProjects.find((initial) => initial.id === project.id) ?? {
              client: null,
              jobCount: 0,
              completedJobCount: 0,
              inProgressJobCount: 0,
              parkedJobCount: 0,
            }),
            ...project,
          }))
        : deriveProjects(rawProjects, jobs),
    [rawProjects, jobs, preserveProjectCounts, initialProjects],
  );

  return {
    jobs,
    setJobs,
    rawProjects,
    setRawProjects,
    projects,
    jobAssignmentMap,
    setJobAssignmentMap,
  };
}
