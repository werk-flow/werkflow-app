'use client';

import type { JobEntityOption } from '@/lib/jobs/option-types';
import { useJobProjectOptions } from './job-form-options';

type EditJobClientProjectLinkInput = {
  /** The job's current project, labelled before the server answers. */
  knownProject: JobEntityOption | undefined;
  clientId: string;
  projectId: string;
  setClientId: (clientId: string) => void;
  setProjectId: (projectId: string) => void;
  setSiteId: (siteId: string) => void;
  setContactId: (contactId: string) => void;
};

/** Keeps customer and project of the edited job consistent: a project fixes its customer, a customer change drops site and contact. */
export function useEditJobClientProjectLink({
  knownProject,
  clientId,
  projectId,
  setClientId,
  setProjectId,
  setSiteId,
  setContactId,
}: EditJobClientProjectLinkInput) {
  const { projectSearch, findProject, projectClientLabel } = useJobProjectOptions({
    clientId,
    projectId,
    knownProject,
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
      const selectedProject = findProject(projectId);
      if (selectedProject?.clientId && newClientId && selectedProject.clientId !== newClientId) {
        setProjectId('');
      }
    }
  };

  const handleProjectChange = (newProjectId: string) => {
    setProjectId(newProjectId);
    if (newProjectId) {
      const selected = findProject(newProjectId);
      if (selected) {
        const nextClientId = selected.clientId ?? '';
        if (nextClientId !== clientId) {
          setSiteId('');
          setContactId('');
        }
        setClientId(nextClientId);
      }
    }
  };

  return {
    projectSearch,
    isClientLocked,
    lockedClientLabel: projectClientLabel,
    handleClientChange,
    handleProjectChange,
  };
}
