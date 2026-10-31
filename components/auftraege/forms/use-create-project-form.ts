'use client';

import { usePendingTask } from '@/hooks/use-server-action';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useSuggestedRecordNumber } from '@/hooks/use-suggested-record-number';
import { useState } from 'react';
import type { Job } from '@/lib/jobs/types';
import type { ClientSelectItem } from '../shared/client-select-with-create';

type CreateProjectFormInput = {
  defaultClient: ClientSelectItem | undefined;
  jobs: Job[];
  readOnlyClient: boolean | undefined;
  isActive: boolean;
};

/** The running create call and the errors it shows once a submit was attempted. */
function useCreateProjectSubmitState() {
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [projectNumberError, setProjectNumberError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const showContentError = hasAttemptedSubmit && contentError;
  const showProjectNumberError = hasAttemptedSubmit && projectNumberError;

  return {
    isLoading,
    runSubmit,
    error,
    setError,
    contentError,
    setContentError,
    showContentError,
    projectNumberError,
    setProjectNumberError,
    showProjectNumberError,
    setHasAttemptedSubmit,
  };
}

type CreateProjectJobSearchInput = {
  clientId: string;
  selectedJobIds: string[];
  jobs: Job[];
};

/**
 * The job choices, searched on the server, seeded with the page's selected
 * jobs and its open unlinked jobs of the chosen customer (or without one).
 */
function useCreateProjectJobSearch({ clientId, selectedJobIds, jobs }: CreateProjectJobSearchInput) {
  return useJobEntityOptions(
    { kind: 'jobs', purpose: 'project-jobs', clientId: clientId || undefined },
    selectedJobIds,
    jobs
      .filter(
        (job) =>
          selectedJobIds.includes(job.id) ||
          (!job.projectId &&
            job.status !== 'fertig' &&
            (!clientId || !job.clientId || job.clientId === clientId)),
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
}

/** Draft state of the create-project form, with the suggested project number and the job options. */
export function useCreateProjectForm({
  defaultClient,
  jobs,
  readOnlyClient,
  isActive,
}: CreateProjectFormInput) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [clientId, setClientId] = useState<string>(defaultClient?.id ?? '');
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const submitState = useCreateProjectSubmitState();
  const { setContentError, setProjectNumberError, setHasAttemptedSubmit } = submitState;

  useSuggestedRecordNumber('next-project-number', isActive, (suggestion) =>
    setProjectNumber((current) => current || suggestion),
  );

  const jobSearch = useCreateProjectJobSearch({ clientId, selectedJobIds, jobs });

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    setSiteId('');
    setContactId('');
    if (selectedJobIds.length > 0) {
      // A list page is not the selection universe. Discard only hydrated,
      // incompatible choices; unknown selected identities must not be unlinked.
      const incompatible = new Set(
        jobSearch.options
          .filter((job) => job.clientId && newClientId && job.clientId !== newClientId)
          .map((job) => job.value),
      );
      setSelectedJobIds((previous) => previous.filter((id) => !incompatible.has(id)));
    }
  };

  // A read-only customer is the default one the page passed in.
  const readOnlyClientLabel = !readOnlyClient ? undefined : clientId ? defaultClient?.name : 'Kein Kunde';

  const resetForm = () => {
    setName('');
    setDescription('');
    setClientId(defaultClient?.id ?? '');
    setSiteId('');
    setContactId('');
    setProjectNumber('');
    setPlannedStartDate(undefined);
    setPlannedEndDate(undefined);
    setSelectedJobIds([]);
    setTemplateVersionId('');
    setHasAttemptedSubmit(false);
    setContentError(null);
    setProjectNumberError(null);
  };

  const formDisabled = submitState.isLoading;

  return {
    ...submitState,
    name,
    setName,
    description,
    setDescription,
    projectNumber,
    setProjectNumber,
    templateVersionId,
    setTemplateVersionId,
    clientId,
    handleClientChange,
    readOnlyClientLabel,
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
    jobSearch,
    formDisabled,
    resetForm,
  };
}

export type CreateProjectForm = ReturnType<typeof useCreateProjectForm>;
