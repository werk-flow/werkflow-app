'use client';

import { useEffect, useMemo, useState } from 'react';

import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import {
  type Client,
  type Job,
  type Project,
  type ProjectWithDetails,
} from '@/lib/jobs/types';

type JobAssignmentMap = Record<string, string[]>;

type UseLiveAuftraegeDataArgs = {
  initialJobs: Job[];
  initialProjects: ProjectWithDetails[];
  supportProjects?: ProjectWithDetails[];
  initialJobAssignmentMap: JobAssignmentMap;
  clients: Client[];
};

function mergeProjects(
  primaryProjects: ProjectWithDetails[],
  supportProjects: ProjectWithDetails[] = []
): Project[] {
  const merged = new Map<string, Project>();

  for (const project of [...supportProjects, ...primaryProjects]) {
    merged.set(project.id, stripProjectDetails(project));
  }

  return Array.from(merged.values());
}

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

function deriveProjects(
  rawProjects: Project[],
  jobs: Job[],
  clients: Client[]
): ProjectWithDetails[] {
  const clientLookup = new Map(clients.map((client) => [client.id, client]));
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
      client: project.clientId ? clientLookup.get(project.clientId) ?? null : null,
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
  supportProjects,
  initialJobAssignmentMap,
  clients,
}: UseLiveAuftraegeDataArgs) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [rawProjects, setRawProjects] = useState<Project[]>(
    mergeProjects(initialProjects, supportProjects)
  );
  const [jobAssignmentMap, setJobAssignmentMap] =
    useState<JobAssignmentMap>(initialJobAssignmentMap);

  // Server props are the authority for this list: every Realtime change
  // triggers a debounced route refresh, and the sync effects below adopt the
  // fresh props. The setters remain for the caller's own-action optimistic
  // echoes (D4: a user's own action reflects instantly).
  useRealtimeRouterRefresh({
    tables: ['jobs', 'projects', 'job_assignments'],
  });

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    setRawProjects(mergeProjects(initialProjects, supportProjects));
  }, [initialProjects, supportProjects]);

  useEffect(() => {
    setJobAssignmentMap(initialJobAssignmentMap);
  }, [initialJobAssignmentMap]);

  const projects = useMemo(
    () => deriveProjects(rawProjects, jobs, clients),
    [rawProjects, jobs, clients]
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
