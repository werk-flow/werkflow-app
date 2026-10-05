'use client';

import type { Client, ProjectWithDetails } from '@/lib/jobs/types';
import { useJobProjectOptions } from './job-form-options';

type EditJobClientProjectLinkInput = {
  clients: Client[];
  projects: ProjectWithDetails[];
  clientId: string;
  projectId: string;
  setClientId: (clientId: string) => void;
  setProjectId: (projectId: string) => void;
  setSiteId: (siteId: string) => void;
  setContactId: (contactId: string) => void;
};

/** Keeps customer and project of the edited job consistent: a project fixes its customer, a customer change drops site and contact. */
export function useEditJobClientProjectLink({
  clients,
  projects,
  clientId,
  projectId,
  setClientId,
  setProjectId,
  setSiteId,
  setContactId,
}: EditJobClientProjectLinkInput) {
  const { projectSearch, projectOptions, activeProjects, projectClientLabel } = useJobProjectOptions({
    clients,
    projects,
    clientId,
    projectId,
  });
  const isClientLocked = Boolean(projectId);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    // Sites and contacts belong to one customer; a change invalidates them.
    if (newClientId !== clientId) {
      setSiteId('');
      setContactId('');
    }
    if (projectId) {
      const selectedProject = activeProjects.find((p) => p.id === projectId);
      if (
        selectedProject &&
        newClientId &&
        selectedProject.clientId !== newClientId &&
        selectedProject.clientId !== null
      ) {
        setProjectId('');
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    if (newProjectId) {
      const selected = activeProjects.find((p) => p.id === newProjectId);
      if (selected) {
        if (selected.clientId !== clientId) {
          setSiteId('');
          setContactId('');
        }
        if (selected.clientId) {
          setClientId(selected.clientId);
        } else {
          setClientId('');
        }
      }
    }
  };

  return {
    projectSearch,
    projectOptions,
    isClientLocked,
    lockedClientLabel: projectClientLabel,
    handleClientChange,
    handleProjectChange,
  };
}
