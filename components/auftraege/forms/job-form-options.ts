'use client';

import { useMemo } from 'react';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import {
  JOB_PRIORITY_LABELS,
  type Client,
  type JobPriority,
  type ProjectWithDetails,
} from '@/lib/jobs/types';

/** The priority choices of the create and edit job forms. */
export const JOB_PRIORITY_OPTIONS: readonly { value: JobPriority; label: string }[] = [
  { value: 'niedrig', label: JOB_PRIORITY_LABELS.niedrig },
  { value: 'mittel', label: JOB_PRIORITY_LABELS.mittel },
  { value: 'hoch', label: JOB_PRIORITY_LABELS.hoch },
];

type JobProjectOptionsInput = {
  clients: Client[];
  projects: ProjectWithDetails[];
  clientId: string;
  projectId: string;
};

function isProjectOpen(project: ProjectWithDetails): boolean {
  return project.statusOverride
    ? project.statusOverride !== 'abgeschlossen'
    : !(project.jobCount > 0 && project.completedJobCount === project.jobCount);
}

/**
 * The project choices of a job form: open projects of the chosen customer (or
 * without one), plus the currently linked project even when it is closed.
 */
export function useJobProjectOptions({ clients, projects, clientId, projectId }: JobProjectOptionsInput) {
  const projectSearch = useJobEntityOptions(
    { kind: 'projects', purpose: 'job-project', clientId: clientId || undefined },
    projectId ? [projectId] : [],
    projects
      .filter(
        (project) =>
          project.id === projectId ||
          (isProjectOpen(project) && (!clientId || !project.clientId || project.clientId === clientId)),
      )
      .map((project) => ({
        value: project.id,
        label: project.projectNumber ? `${project.projectNumber} – ${project.name}` : project.name,
        clientId: project.clientId,
      })),
  );
  const projectOptions = projectSearch.options;
  const activeProjects = useMemo(
    () =>
      projectOptions.map((option) => ({
        id: option.value,
        clientId: option.clientId ?? null,
        siteId: projects.find((project) => project.id === option.value)?.siteId ?? null,
        contactId: projects.find((project) => project.id === option.value)?.contactId ?? null,
      })),
    [projectOptions, projects],
  );

  // The customer shown read-only while a project fixes it.
  const projectClientLabel = useMemo(() => {
    if (!projectId) return undefined;
    const selected = activeProjects.find((p) => p.id === projectId);
    if (!selected) return undefined;
    if (!selected.clientId) return 'Kein Kunde';
    return clients.find((cl) => cl.id === selected.clientId)?.name;
  }, [projectId, activeProjects, clients]);

  return { projectSearch, projectOptions, activeProjects, projectClientLabel };
}
