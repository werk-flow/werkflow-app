'use client';

import { useClientRead } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useState, useEffect, useRef } from 'react';
import { describeFailure } from '@/lib/action-messages';
import { getProjectDetails } from '@/lib/projects/actions';
import type { Job, ProjectWithDetails } from '@/lib/jobs/types';

export const ERROR_MESSAGES = {
  not_authorized: 'Du bist nicht berechtigt, Projekte zu verwalten.',
  name_or_description_required: 'Bitte gib mindestens einen Titel oder eine Beschreibung ein.',
  project_not_found: 'Projekt nicht gefunden.',
  client_not_found: 'Kunde nicht gefunden.',
  no_changes: 'Keine Änderungen vorgenommen.',
  update_failed: 'Fehler beim Aktualisieren des Projekts.',
} satisfies Record<string, string>;

type EditProjectFormInput = {
  project: ProjectWithDetails;
  open: boolean;
  jobs: Job[];
};

/** Draft state of the edit-project dialog: filled from the project, and its linked jobs loaded, each time the dialog opens. */
export function useEditProjectForm({ project, open, jobs }: EditProjectFormInput) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [originalJobIds, setOriginalJobIds] = useState<string[]>([]);
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const initializedProjectIdRef = useRef<string | null>(null);

  // The linked jobs are read each time the dialog opens; a closed dialog drops the read.
  const projectJobs = useClientRead({
    read: () => getProjectDetails(project.id),
    deps: [project.id],
    enabled: open,
    failureMessage: (code) =>
      describeFailure(code, ERROR_MESSAGES, 'Die Projektaufträge konnten nicht geladen werden.'),
  });
  // Adopted during render: an answer, or its absence after a failure or a close, sets both lists.
  const [adoptedJobs, setAdoptedJobs] = useState(projectJobs.data);
  if (projectJobs.data !== adoptedJobs) {
    setAdoptedJobs(projectJobs.data);
    const ids = projectJobs.data?.details.jobs.map((job) => job.id) ?? [];
    setSelectedJobIds(ids);
    setOriginalJobIds(ids);
  }
  const isLoadingJobs = projectJobs.loading;

  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'project-jobs', clientId: clientId || undefined, projectId: project.id },
    selectedJobIds,
    jobs
      .filter(
        (job) =>
          selectedJobIds.includes(job.id) ||
          ((!job.projectId || job.projectId === project.id) &&
            (job.projectId === project.id || !clientId || !job.clientId || job.clientId === clientId)),
      )
      .map((job) => ({
        value: job.id,
        label: job.title || job.description || 'Auftrag',
        description: job.jobNumber ?? undefined,
        clientId: job.clientId,
        projectId: job.projectId,
        status: job.status,
      })),
  );

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    if (newClientId !== clientId) {
      setSiteId('');
      setContactId('');
    }
    if (selectedJobIds.length > 0) {
      // A list page is not the selection universe. Discard only hydrated,
      // incompatible choices; unknown selected identities must not be unlinked.
      const incompatible = new Set(
        jobSearch.options
          .filter(
            (job) =>
              job.clientId && newClientId && job.clientId !== newClientId && job.projectId !== project.id,
          )
          .map((job) => job.value),
      );
      setSelectedJobIds((previous) => previous.filter((id) => !incompatible.has(id)));
    }
  };

  useEffect(() => {
    if (!open) {
      initializedProjectIdRef.current = null;
      return;
    }
    if (initializedProjectIdRef.current === project.id) return;
    initializedProjectIdRef.current = project.id;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- the draft is refilled from the project each time the dialog opens
    setName(project.name);
    setDescription(project.description ?? '');
    setClientId(project.clientId ?? '');
    setSiteId(project.siteId ?? '');
    setContactId(project.contactId ?? '');
    setProjectNumber(project.projectNumber ?? '');
    setPlannedStartDate(
      project.plannedStartDate ? new Date(project.plannedStartDate + 'T00:00:00') : undefined,
    );
    setPlannedEndDate(project.plannedEndDate ? new Date(project.plannedEndDate + 'T00:00:00') : undefined);
    setError(null);
    setContentError(null);
    setHasAttemptedSubmit(false);
  }, [open, project]);

  const showContentError = hasAttemptedSubmit && contentError;
  // The fields stay editable while the project's jobs load; only the job picker and the save wait for them.
  const formDisabled = isLoading;

  return {
    name,
    setName,
    description,
    setDescription,
    projectNumber,
    setProjectNumber,
    clientId,
    handleClientChange,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    plannedStartDate,
    setPlannedStartDate,
    plannedEndDate,
    setPlannedEndDate,
    selectedJobIds,
    setSelectedJobIds,
    originalJobIds,
    jobSearch,
    isLoading,
    runSubmit,
    isLoadingJobs,
    jobsFailure: projectJobs.failure,
    error,
    setError,
    contentError,
    setContentError,
    showContentError,
    setHasAttemptedSubmit,
    formDisabled,
  };
}

export type EditProjectForm = ReturnType<typeof useEditProjectForm>;
