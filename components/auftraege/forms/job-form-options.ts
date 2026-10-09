'use client';

import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { JOB_PRIORITY_LABELS, type JobPriority, type Project } from '@/lib/jobs/types';

/** The priority choices of the create and edit job forms. */
export const JOB_PRIORITY_OPTIONS: readonly { value: JobPriority; label: string }[] = [
  { value: 'niedrig', label: JOB_PRIORITY_LABELS.niedrig },
  { value: 'mittel', label: JOB_PRIORITY_LABELS.mittel },
  { value: 'hoch', label: JOB_PRIORITY_LABELS.hoch },
];

type KnownProject = Pick<Project, 'id' | 'name' | 'projectNumber' | 'clientId'> &
  Partial<Pick<Project, 'siteId' | 'contactId'>>;

/** A project the page already shows, in the shape the project search returns. */
export function knownProjectOption(project: KnownProject, clientName: string | null): JobEntityOption {
  return {
    value: project.id,
    label: project.projectNumber ? `${project.projectNumber} – ${project.name}` : project.name,
    number: project.projectNumber,
    name: project.name,
    clientId: project.clientId,
    clientName,
    siteId: project.siteId ?? null,
    contactId: project.contactId ?? null,
  };
}

/** The project name of a search option, whose label leads with the project number. */
export function projectNameOfOption(option: JobEntityOption): string {
  return option.name ?? option.label;
}

type JobProjectOptionsInput = {
  clientId: string;
  projectId: string;
  /** The project the form starts with, labelled before the server answers. */
  knownProject?: JobEntityOption | undefined;
};

/**
 * The project choices of a job form, searched on the server: open projects of
 * the chosen customer (or without one), plus the linked project even when it
 * is closed. The chosen option carries the customer, site and contact a job
 * copies.
 */
export function useJobProjectOptions({ clientId, projectId, knownProject }: JobProjectOptionsInput) {
  const projectSearch = useJobEntityOptions(
    { kind: 'projects', purpose: 'job-project', clientId: clientId || undefined },
    projectId ? [projectId] : [],
    knownProject ? [knownProject] : undefined,
  );
  const findProject = (id: string): JobEntityOption | undefined =>
    projectSearch.options.find((option) => option.value === id) ??
    (knownProject?.value === id ? knownProject : undefined);

  // The customer shown read-only while a project fixes it.
  const selectedProject = projectId ? findProject(projectId) : undefined;
  const projectClientLabel = selectedProject
    ? selectedProject.clientId
      ? (selectedProject.clientName ?? undefined)
      : 'Kein Kunde'
    : undefined;

  return { projectSearch, findProject, projectClientLabel };
}
