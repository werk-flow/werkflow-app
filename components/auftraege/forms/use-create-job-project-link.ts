'use client';

import { useRef, useState } from 'react';

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
  const selectedProjectRef = useRef(defaultProject?.value ?? '');
  const [isLoadingProjectDefaults, setIsLoadingProjectDefaults] = useState(false);
  const [projectDefaultsLoadFailed, setProjectDefaultsLoadFailed] = useState(false);
  // Prefill from the project's default site/contact when creating inside one.
  const [siteId, setSiteId] = useState<string>(defaultProject?.siteId ?? '');
  const [contactId, setContactId] = useState<string>(defaultProject?.contactId ?? '');

  const { projectSearch, findProject, projectClientLabel } = useJobProjectOptions({
    clientId,
    projectId,
    knownProject: defaultProject,
  });

  const isClientLocked = Boolean(readOnlyClient || projectId);
  // A fixed customer without a project shows that customer; a project shows its own.
  const lockedClientLabel =
    readOnlyClient && !projectId ? (clientId ? defaultClient?.name : 'Kein Kunde') : projectClientLabel;

  const handleClientChange = (newClientId: string) => {
    setProjectDefaultsLoadFailed(false);
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    setSiteId('');
    setContactId('');
    if (projectId) {
      const selectedProject = findProject(projectId);
      if (selectedProject?.clientId && newClientId && selectedProject.clientId !== newClientId) {
        selectedProjectRef.current = '';
        setProjectId('');
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectDefaultsLoadFailed(false);
    selectedProjectRef.current = newProjectId;
    setProjectId(newProjectId);
    if (newProjectId) {
      setIsLoadingProjectDefaults(true);
      const selected = findProject(newProjectId);
      if (selected) {
        if (!readOnlyClient) {
          setClientId(selected.clientId ?? '');
        }
        // The project's default site/contact prefill the job; both stay
        // overridable per job.
        setSiteId(selected.siteId ?? '');
        setContactId(selected.contactId ?? '');
      }
      void getProjectDetails(newProjectId)
        .then((result) => {
          if (selectedProjectRef.current !== newProjectId) return;
          if (!result.success) {
            setSiteId('');
            setContactId('');
            setProjectDefaultsLoadFailed(true);
            return;
          }
          const project = result.details.project;
          if (!readOnlyClient) setClientId(project.clientId ?? '');
          setSiteId(project.siteId ?? '');
          setContactId(project.contactId ?? '');
          setProjectDefaultsLoadFailed(false);
        })
        .catch(() => {
          if (selectedProjectRef.current !== newProjectId) return;
          setSiteId('');
          setContactId('');
          setProjectDefaultsLoadFailed(true);
        })
        .finally(() => {
          if (selectedProjectRef.current === newProjectId) {
            setIsLoadingProjectDefaults(false);
          }
        });
    } else {
      setIsLoadingProjectDefaults(false);
      setSiteId('');
      setContactId('');
    }
  };

  return {
    clientId,
    projectId,
    siteId,
    setSiteId,
    contactId,
    setContactId,
    isLoadingProjectDefaults,
    projectDefaultsLoadFailed,
    projectSearch,
    isClientLocked,
    lockedClientLabel,
    handleClientChange,
    handleProjectChange,
    retryProjectDefaults: () => handleProjectChange(projectId),
  };
}
