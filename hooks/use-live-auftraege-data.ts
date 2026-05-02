'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
import {
  toJob,
  toProject,
  type Client,
  type Job,
  type JobAssignmentRow,
  type JobRow,
  type Project,
  type ProjectRow,
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
    plannedStartDate: project.plannedStartDate,
    plannedEndDate: project.plannedEndDate,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function upsertJob(prev: Job[], job: Job): Job[] {
  const next = prev.filter((entry) => entry.id !== job.id);
  next.push(job);
  return next;
}

function removeJob(prev: Job[], jobId: string): Job[] {
  return prev.filter((entry) => entry.id !== jobId);
}

function upsertProject(prev: Project[], project: Project): Project[] {
  const next = prev.filter((entry) => entry.id !== project.id);
  next.push(project);
  return next;
}

function removeProject(prev: Project[], projectId: string): Project[] {
  return prev.filter((entry) => entry.id !== projectId);
}

function updateAssignmentMapWithInsert(
  prev: JobAssignmentMap,
  jobId: string,
  userId: string
): JobAssignmentMap {
  const current = prev[jobId] ?? [];
  if (current.includes(userId)) return prev;
  return {
    ...prev,
    [jobId]: [...current, userId],
  };
}

function updateAssignmentMapWithDelete(
  prev: JobAssignmentMap,
  jobId: string,
  userId: string
): JobAssignmentMap {
  const current = prev[jobId] ?? [];
  if (!current.includes(userId)) return prev;

  const nextUsers = current.filter((entry) => entry !== userId);
  if (nextUsers.length === 0) {
    const next = { ...prev };
    delete next[jobId];
    return next;
  }

  return {
    ...prev,
    [jobId]: nextUsers,
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
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [rawProjects, setRawProjects] = useState<Project[]>(
    mergeProjects(initialProjects, supportProjects)
  );
  const [jobAssignmentMap, setJobAssignmentMap] =
    useState<JobAssignmentMap>(initialJobAssignmentMap);
  const repairTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRepair = useCallback(() => {
    if (repairTimerRef.current) {
      clearTimeout(repairTimerRef.current);
    }

    repairTimerRef.current = setTimeout(() => {
      repairTimerRef.current = null;
      router.refresh();
    }, 150);
  }, [router]);

  useEffect(() => {
    setJobs(initialJobs);
  }, [initialJobs]);

  useEffect(() => {
    setRawProjects(mergeProjects(initialProjects, supportProjects));
  }, [initialProjects, supportProjects]);

  useEffect(() => {
    setJobAssignmentMap(initialJobAssignmentMap);
  }, [initialJobAssignmentMap]);

  useEffect(() => {
    return () => {
      if (repairTimerRef.current) {
        clearTimeout(repairTimerRef.current);
      }
    };
  }, []);

  useRealtimeEvent('jobs', (event) => {
    if (!event.new && !event.old) {
      scheduleRepair();
      return;
    }

    if (event.eventType === 'DELETE') {
      const oldJobId = (event.old as { id?: string } | null)?.id;
      if (!oldJobId) return;
      setJobs((prev) => removeJob(prev, oldJobId));
      setJobAssignmentMap((prev) => {
        if (!prev[oldJobId]) return prev;
        const next = { ...prev };
        delete next[oldJobId];
        return next;
      });
      return;
    }

    if (!event.new) return;
    setJobs((prev) => upsertJob(prev, toJob(event.new as JobRow)));
  });

  useRealtimeEvent('projects', (event) => {
    if (!event.new && !event.old) {
      scheduleRepair();
      return;
    }

    if (event.eventType === 'DELETE') {
      const oldProjectId = (event.old as { id?: string } | null)?.id;
      if (!oldProjectId) return;
      setRawProjects((prev) => removeProject(prev, oldProjectId));
      setJobs((prev) =>
        prev.map((job) =>
          job.projectId === oldProjectId ? { ...job, projectId: null } : job
        )
      );
      return;
    }

    if (!event.new) return;
    setRawProjects((prev) => upsertProject(prev, toProject(event.new as ProjectRow)));
  });

  useRealtimeEvent('job_assignments', (event) => {
    if (!event.new && !event.old) {
      scheduleRepair();
      return;
    }

    if (event.eventType === 'DELETE') {
      const oldRow = event.old as JobAssignmentRow | null;
      if (!oldRow) return;
      setJobAssignmentMap((prev) =>
        updateAssignmentMapWithDelete(prev, oldRow.job_id, oldRow.user_id)
      );
      return;
    }

    const newRow = event.new as JobAssignmentRow | null;
    const oldRow = event.old as JobAssignmentRow | null;

    setJobAssignmentMap((prev) => {
      let next = prev;

      if (oldRow) {
        next = updateAssignmentMapWithDelete(next, oldRow.job_id, oldRow.user_id);
      }

      if (newRow) {
        next = updateAssignmentMapWithInsert(next, newRow.job_id, newRow.user_id);
      }

      return next;
    });
  });

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
