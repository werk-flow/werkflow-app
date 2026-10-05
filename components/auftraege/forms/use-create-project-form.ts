'use client';

import { usePendingTask } from '@/hooks/use-server-action';
import { useJobEntityOptions } from '@/hooks/use-job-entity-options';
import { useState, useMemo, useEffect } from 'react';
import { getNextProjectNumber } from '@/lib/projects/actions';
import type { Client, Job } from '@/lib/jobs/types';

type CreateProjectFormInput = {
  clients: Client[];
  jobs: Job[];
  defaultClientId: string | undefined;
  readOnlyClient: boolean | undefined;
  isActive: boolean;
};

/** Draft state of the create-project form, with the suggested project number and the job options. */
export function useCreateProjectForm({
  clients,
  jobs,
  defaultClientId,
  readOnlyClient,
  isActive,
}: CreateProjectFormInput) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [clientId, setClientId] = useState<string>(defaultClientId ?? '');
  const [siteId, setSiteId] = useState<string>('');
  const [contactId, setContactId] = useState<string>('');
  const [projectNumber, setProjectNumber] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState<Date | undefined>();
  const [plannedEndDate, setPlannedEndDate] = useState<Date | undefined>();
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const { run: runSubmit, isPending: isLoading } = usePendingTask();
  const [error, setError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [projectNumberError, setProjectNumberError] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    getNextProjectNumber().then((result) => {
      if (result.success) {
        setProjectNumber((current) => current || result.projectNumber);
      }
    });
  }, [isActive]);

  const jobSearch = useJobEntityOptions(
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

  const unlinkedJobs = useMemo(() => {
    const baseJobs = jobs.filter((j) => !j.projectId && j.status !== 'fertig');
    if (!clientId) return baseJobs;
    return baseJobs.filter((j) => j.clientId === clientId || !j.clientId);
  }, [jobs, clientId]);

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

  const readOnlyClientLabel = useMemo(() => {
    if (!readOnlyClient) return undefined;
    if (!clientId) return 'Kein Kunde';
    const client = clients.find((entry) => entry.id === clientId);
    return client?.name;
  }, [readOnlyClient, clientId, clients]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setClientId(defaultClientId ?? '');
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

  const showContentError = hasAttemptedSubmit && contentError;
  const showProjectNumberError = hasAttemptedSubmit && projectNumberError;
  const formDisabled = isLoading;

  return {
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
    unlinkedJobs,
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
    formDisabled,
    resetForm,
  };
}

export type CreateProjectForm = ReturnType<typeof useCreateProjectForm>;
