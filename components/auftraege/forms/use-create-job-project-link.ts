'use client';

import { useState } from 'react';

import { useClientRead } from '@/hooks/use-client-read';
import type { JobEntityOption } from '@/lib/jobs/option-types';
import { getProjectDetails } from '@/lib/projects/actions';
import type { ClientSelectItem } from '../shared/client-select-with-create';
import { useJobProjectOptions } from './job-form-options';

type CreateJobProjectLinkOptions = {
  defaultClient: ClientSelectItem | undefined;
  defaultProject: JobEntityOption | undefined;
  readOnlyClient: boolean | undefined;
};

/**
 * Customer, project, site and contact of a new job. Choosing a project adopts
 * its customer and its default site and contact; changing the customer drops
 * what belonged to the previous one.
 */
export function useCreateJobProjectLink({
  defaultClient,
  defaultProject,
  readOnlyClient,
}: CreateJobProjectLinkOptions) {
  const [clientId, setClientId] = useState<string>(defaultClient?.id ?? '');
  const [projectId, setProjectId] = useState<string>(defaultProject?.value ?? '');
  // The project the user chose; its defaults are read again on every choice.
  const [projectChoice, setProjectChoice] = useState({ projectId: '', count: 0 });
  // Prefill from the project's default site/contact when creating inside one.
  const [siteId, setSiteId] = useState<string>(defaultProject?.siteId ?? '');
  const [contactId, setContactId] = useState<string>(defaultProject?.contactId ?? '');

  const { projectSearch, findProject, projectClientLabel } = useJobProjectOptions({
    clientId,
    projectId,
    knownProject: defaultProject,
  });

  const projectDefaults = useClientRead({
    read: () => getProjectDetails(projectChoice.projectId),
    deps: [projectChoice.projectId, projectChoice.count],
    enabled: projectChoice.projectId !== '' && projectChoice.projectId === projectId,
    failureMessage: 'Die Projektvorgaben konnten nicht geladen werden.',
  });
  // The read's answer is adopted during render, never in an effect.
  const [adoptedDefaults, setAdoptedDefaults] = useState(projectDefaults.data);
  if (projectDefaults.data !== adoptedDefaults) {
    setAdoptedDefaults(projectDefaults.data);
    const project = projectDefaults.data?.details.project;
    if (project) {
      if (!readOnlyClient) setClientId(project.clientId ?? '');
      setSiteId(project.siteId ?? '');
      setContactId(project.contactId ?? '');
    }
  }

  const isClientLocked = Boolean(readOnlyClient || projectId);
  // A fixed customer without a project shows that customer; a project shows its own.
  const lockedClientLabel =
    readOnlyClient && !projectId ? (clientId ? defaultClient?.name : 'Kein Kunde') : projectClientLabel;

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    setSiteId('');
    setContactId('');
    if (projectId) {
      const selectedProject = findProject(projectId);
      if (selectedProject?.clientId && newClientId && selectedProject.clientId !== newClientId) {
        setProjectId('');
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    setProjectChoice((previous) => ({ projectId: newProjectId, count: previous.count + 1 }));
    if (!newProjectId) {
      setSiteId('');
      setContactId('');
      return;
    }
    const selected = findProject(newProjectId);
    if (!selected) return;
    if (!readOnlyClient) setClientId(selected.clientId ?? '');
    // The project's default site/contact prefill the job; both stay overridable per job.
    setSiteId(selected.siteId ?? '');
    setContactId(selected.contactId ?? '');
  };

  return {
    clientId,
    projectId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    isLoadingProjectDefaults: projectDefaults.loading,
    /** The failed read of the chosen project's defaults; the job cannot be saved until it succeeds. */
    projectDefaultsFailure: projectDefaults.failure,
    projectSearch,
    isClientLocked,
    lockedClientLabel,
    handleClientChange,
    handleProjectChange,
  };
}
