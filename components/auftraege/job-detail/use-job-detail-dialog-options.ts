'use client';

import { useState, useEffect, useRef } from 'react';
import { getAuftraegeDialogOptions } from '@/lib/jobs/actions';
import type { Client, ProjectWithDetails } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';

type JobDetailDialogOptionsInput = {
  clients: Client[];
  members: OrgMemberOption[];
  projects: ProjectWithDetails[];
  isAdminOrManager: boolean;
  showAssignDialog: boolean;
  showClientDialog: boolean;
  showProjectDialog: boolean;
  showEditDialog: boolean;
};

const DIALOG_OPTIONS_LOAD_FAILED_MESSAGE = 'Die Auswahllisten konnten nicht geladen werden.';

/**
 * Option lists for the job dialogs: the server props, loaded on demand when a
 * dialog opens without them. A failed load stays visible with a retry.
 */
export function useJobDetailDialogOptions({
  clients,
  members,
  projects,
  isAdminOrManager,
  showAssignDialog,
  showClientDialog,
  showProjectDialog,
  showEditDialog,
}: JobDetailDialogOptionsInput) {
  const [dialogClients, setDialogClients] = useState(clients);
  const [dialogMembers, setDialogMembers] = useState(members);
  const [dialogProjects, setDialogProjects] = useState(projects);
  const dialogOptionsRequestInFlightRef = useRef(false);
  const [isLoadingDialogOptions, setIsLoadingDialogOptions] = useState(false);
  const [dialogOptionsError, setDialogOptionsError] = useState<string | null>(null);
  const [dialogOptionsRefreshKey, setDialogOptionsRefreshKey] = useState(0);

  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedProps, setAdoptedProps] = useState({ clients, members, projects });
  if (
    clients !== adoptedProps.clients ||
    members !== adoptedProps.members ||
    projects !== adoptedProps.projects
  ) {
    setAdoptedProps({ clients, members, projects });
    if (clients !== adoptedProps.clients) setDialogClients(clients);
    if (members !== adoptedProps.members) setDialogMembers(members);
    if (projects !== adoptedProps.projects) setDialogProjects(projects);
  }

  useEffect(() => {
    if (
      !isAdminOrManager ||
      dialogOptionsRequestInFlightRef.current ||
      (!showAssignDialog && !showClientDialog && !showProjectDialog && !showEditDialog) ||
      (!(showClientDialog && dialogClients.length === 0) &&
        !(showAssignDialog && dialogMembers.length === 0) &&
        !(showProjectDialog && dialogProjects.length === 0) &&
        !(
          showEditDialog &&
          (dialogClients.length === 0 || dialogMembers.length === 0 || dialogProjects.length === 0)
        ))
    ) {
      return;
    }

    // No cancellation: the one in-flight request always settles the loading
    // and error state, even when the dialog closed or reopened meanwhile; the
    // organization's option lists stay valid whichever dialog asked for them.
    dialogOptionsRequestInFlightRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the option read starts here; its loading and error state belong to the request the effect sends
    setIsLoadingDialogOptions(true);
    setDialogOptionsError(null);
    getAuftraegeDialogOptions()
      .then((result) => {
        if (!result.success) {
          setDialogOptionsError(DIALOG_OPTIONS_LOAD_FAILED_MESSAGE);
          return;
        }
        setDialogClients(result.clients);
        setDialogMembers(result.members);
        setDialogProjects(result.projects);
      })
      .catch(() => {
        setDialogOptionsError(DIALOG_OPTIONS_LOAD_FAILED_MESSAGE);
      })
      .finally(() => {
        dialogOptionsRequestInFlightRef.current = false;
        setIsLoadingDialogOptions(false);
      });
  }, [
    dialogClients.length,
    dialogMembers.length,
    dialogOptionsRefreshKey,
    dialogProjects.length,
    isAdminOrManager,
    showAssignDialog,
    showClientDialog,
    showEditDialog,
    showProjectDialog,
  ]);

  const retryDialogOptions = () => setDialogOptionsRefreshKey((value) => value + 1);

  return {
    dialogClients,
    dialogMembers,
    dialogProjects,
    isLoadingDialogOptions,
    dialogOptionsError,
    retryDialogOptions,
  };
}
