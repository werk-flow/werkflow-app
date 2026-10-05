'use client';

import { useRef, useState } from 'react';

import type { Client, ProjectWithDetails } from '@/lib/jobs/types';
import { getProjectDetails } from '@/lib/projects/actions';
import { useJobProjectOptions } from './job-form-options';

type CreateJobProjectLinkOptions = {
  clients: Client[];
  projects: ProjectWithDetails[];
  defaultClientId: string | undefined;
  defaultProjectId: string | undefined;
  readOnlyClient: boolean | undefined;
};

/**
 * Customer, project, site and contact of a new job. Choosing a project adopts
 * its customer and its default site and contact; changing the customer drops
 * what belonged to the previous one.
 */
export function useCreateJobProjectLink({
  clients,
  projects,
  defaultClientId,
  defaultProjectId,
  readOnlyClient,
}: CreateJobProjectLinkOptions) {
  const [clientId, setClientId] = useState<string>(defaultClientId ?? '');
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? '');
  const selectedProjectRef = useRef(defaultProjectId ?? '');
  const [isLoadingProjectDefaults, setIsLoadingProjectDefaults] = useState(false);
  const [projectDefaultsLoadFailed, setProjectDefaultsLoadFailed] = useState(false);
  // Prefill from the project's default site/contact when creating inside one.
  const defaultProject = projects.find((project) => project.id === defaultProjectId);
  const [siteId, setSiteId] = useState<string>(defaultProject?.siteId ?? '');
  const [contactId, setContactId] = useState<string>(defaultProject?.contactId ?? '');

  const { projectSearch, projectOptions, activeProjects, projectClientLabel } = useJobProjectOptions({
    clients,
    projects,
    clientId,
    projectId,
  });

  const isClientLocked = Boolean(readOnlyClient || projectId);
  // A fixed customer without a project shows that customer; a project shows its own.
  const lockedClientLabel =
    readOnlyClient && !projectId
      ? clientId
        ? clients.find((client) => client.id === clientId)?.name
        : 'Kein Kunde'
      : projectClientLabel;

  const handleClientChange = (newClientId: string) => {
    setProjectDefaultsLoadFailed(false);
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    setSiteId('');
    setContactId('');
    if (projectId) {
      const selectedProject = activeProjects.find((p) => p.id === projectId);
      if (
        selectedProject &&
        newClientId &&
        selectedProject.clientId !== newClientId &&
        selectedProject.clientId !== null
      ) {
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
      const selected = activeProjects.find((p) => p.id === newProjectId);
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
    projectOptions,
    isClientLocked,
    lockedClientLabel,
    handleClientChange,
    handleProjectChange,
    retryProjectDefaults: () => handleProjectChange(projectId),
  };
}
