'use client';

import { useClientRead } from '@/hooks/use-client-read';
import { usePendingTask } from '@/hooks/use-server-action';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useState, useEffect, useRef, type RefObject } from 'react';
import { describeFailure } from '@/lib/action-messages';
import { readInBackground } from '@/lib/data/background-read-client';
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
  const fields = useEditProjectDraftFields();
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const initializedProjectIdRef = useRef<string | null>(null);

  const projectJobs = useEditProjectJobs({ project, open, fields });
  const isLoadingJobs = projectJobs.loading;

  const { clientId, selectedJobIds } = fields;
  const jobSearch = useJobEntityOptions(
    { kind: 'jobs', purpose: 'project-jobs', clientId: clientId || undefined, projectId: project.id },
    selectedJobIds,
    knownProjectJobOptions({ jobs, selectedJobIds, projectId: project.id, clientId }),
  );

  const handleClientChange = (newClientId: string) => {
    fields.setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    if (newClientId !== clientId) {
      fields.setSiteId('');
      fields.setContactId('');
    }
    if (selectedJobIds.length > 0) {
      // A list page is not the selection universe. Discard only hydrated,
      // incompatible choices; unknown selected identities must not be unlinked.
      const incompatible = incompatibleJobIds(jobSearch.options, newClientId, project.id);
      fields.setSelectedJobIds((previous) => previous.filter((id) => !incompatible.has(id)));
    }
  };

  useRefillEditProjectDraftOnOpen({
    project,
    open,
    fields,
    resetFeedback: { setError, setContentError, setHasAttemptedSubmit },
    initializedProjectIdRef,
  });

  const showContentError = hasAttemptedSubmit && contentError;
  // The fields stay editable while the project's jobs load; only the job picker and the save wait for them.
  const formDisabled = isLoading;

  return {
    name: fields.name,
    setName: fields.setName,
    description: fields.description,
    setDescription: fields.setDescription,
    projectNumber: fields.projectNumber,
    setProjectNumber: fields.setProjectNumber,
    clientId,
    handleClientChange,
    siteId: fields.siteId,
    setSiteId: fields.setSiteId,
    contactId: fields.contactId,
    setContactId: fields.setContactId,
    plannedStartDate: fields.plannedStartDate,
    setPlannedStartDate: fields.setPlannedStartDate,
    plannedEndDate: fields.plannedEndDate,
    setPlannedEndDate: fields.setPlannedEndDate,
    selectedJobIds,
    setSelectedJobIds: fields.setSelectedJobIds,
    originalJobIds: fields.originalJobIds,
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

/** The project's own fields and its job selection as the dialog edits them. */
function useEditProjectDraftFields() {
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

  return {
    name,
    setName,
    description,
    setDescription,
    clientId,
    setClientId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    projectNumber,
    setProjectNumber,
    plannedStartDate,
    setPlannedStartDate,
    plannedEndDate,
    setPlannedEndDate,
    selectedJobIds,
    setSelectedJobIds,
    originalJobIds,
    setOriginalJobIds,
  };
}

type EditProjectDraftFields = ReturnType<typeof useEditProjectDraftFields>;

type EditProjectJobsInput = {
  project: ProjectWithDetails;
  open: boolean;
  fields: EditProjectDraftFields;
};

/** The linked jobs, read each time the dialog opens; a closed dialog drops the read. */
function useEditProjectJobs({ project, open, fields }: EditProjectJobsInput) {
  const projectJobs = useClientRead({
    read: (signal) => readInBackground('project-details', { projectId: project.id }, signal),
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
    fields.setSelectedJobIds(ids);
    fields.setOriginalJobIds(ids);
  }
  return projectJobs;
}

type KnownProjectJobsInput = {
  jobs: Job[];
  selectedJobIds: string[];
  projectId: string;
  clientId: string;
};

/** The jobs the page already shows that the picker may offer before the server answers. */
function knownProjectJobOptions({ jobs, selectedJobIds, projectId, clientId }: KnownProjectJobsInput) {
  return jobs
    .filter(
      (job) =>
        selectedJobIds.includes(job.id) ||
        ((!job.projectId || job.projectId === projectId) &&
          (job.projectId === projectId || !clientId || !job.clientId || job.clientId === clientId)),
    )
    .map((job) => ({
      value: job.id,
      label: job.title || job.description || 'Auftrag',
      description: job.jobNumber ?? undefined,
      clientId: job.clientId,
      projectId: job.projectId,
      status: job.status,
    }));
}

/** The loaded job choices that belong to another customer and to no job of this project. */
function incompatibleJobIds(
  options: ReturnType<typeof useJobEntityOptions>['options'],
  newClientId: string,
  projectId: string,
): Set<string> {
  return new Set(
    options
      .filter(
        (job) => job.clientId && newClientId && job.clientId !== newClientId && job.projectId !== projectId,
      )
      .map((job) => job.value),
  );
}

type EditProjectDraftRefillInput = {
  project: ProjectWithDetails;
  open: boolean;
  fields: EditProjectDraftFields;
  resetFeedback: {
    setError: (error: string | null) => void;
    setContentError: (error: string | null) => void;
    setHasAttemptedSubmit: (attempted: boolean) => void;
  };
  initializedProjectIdRef: RefObject<string | null>;
};

/** Refills the draft from the project each time the dialog opens. */
function useRefillEditProjectDraftOnOpen({
  project,
  open,
  fields,
  resetFeedback,
  initializedProjectIdRef,
}: EditProjectDraftRefillInput) {
  useEffect(() => {
    if (!open) {
      initializedProjectIdRef.current = null;
      return;
    }
    if (initializedProjectIdRef.current === project.id) return;
    initializedProjectIdRef.current = project.id;

    fields.setName(project.name);
    fields.setDescription(project.description ?? '');
    fields.setClientId(project.clientId ?? '');
    fields.setSiteId(project.siteId ?? '');
    fields.setContactId(project.contactId ?? '');
    fields.setProjectNumber(project.projectNumber ?? '');
    fields.setPlannedStartDate(
      project.plannedStartDate ? new Date(project.plannedStartDate + 'T00:00:00') : undefined,
    );
    fields.setPlannedEndDate(
      project.plannedEndDate ? new Date(project.plannedEndDate + 'T00:00:00') : undefined,
    );
    resetFeedback.setError(null);
    resetFeedback.setContentError(null);
    resetFeedback.setHasAttemptedSubmit(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fields and resetFeedback hold useState setters and the ref is stable; the draft refills only when the dialog opens or the project changes
  }, [open, project]);
}

export type EditProjectForm = ReturnType<typeof useEditProjectForm>;
