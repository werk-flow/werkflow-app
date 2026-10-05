'use client';

import { useEffect, useRef, useState } from 'react';

import { getAuftraegeDialogOptions } from '@/lib/jobs/actions';
import type { Client, Job } from '@/lib/jobs/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';

// The clients, members and jobs load together; every project dialog shows the failure.
const DIALOG_OPTIONS_LOAD_FAILED_MESSAGE = 'Die Auswahllisten konnten nicht geladen werden.';

type ProjectDetailDialogStateOptions = {
  clients: Client[];
  members: OrgMemberOption[];
  isAdminOrManager: boolean;
};

/**
 * Which project dialog is open, and the client, member and job options the
 * open dialog needs. The options load once a dialog that lacks them opens.
 */
export function useProjectDetailDialogState({
  clients,
  members,
  isAdminOrManager,
}: ProjectDetailDialogStateOptions) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showAssignJobsDialog, setShowAssignJobsDialog] = useState(false);
  const [dialogClients, setDialogClients] = useState(clients);
  const [dialogMembers, setDialogMembers] = useState(members);
  const [dialogAvailableJobs, setDialogAvailableJobs] = useState<Job[]>([]);
  const [isLoadingDialogOptions, setIsLoadingDialogOptions] = useState(false);
  const [dialogOptionsError, setDialogOptionsError] = useState<string | null>(null);
  const [dialogOptionsRefreshKey, setDialogOptionsRefreshKey] = useState(0);
  const dialogOptionsRequestInFlightRef = useRef(false);

  // Adopted during render, never in an effect (realtime-and-caching checklist).
  const [adoptedProps, setAdoptedProps] = useState({ clients, members });
  if (clients !== adoptedProps.clients || members !== adoptedProps.members) {
    setAdoptedProps({ clients, members });
    if (clients !== adoptedProps.clients) setDialogClients(clients);
    if (members !== adoptedProps.members) setDialogMembers(members);
  }

  useEffect(() => {
    if (
      !isAdminOrManager ||
      dialogOptionsRequestInFlightRef.current ||
      (!showCreateJob && !showEditDialog && !showClientDialog && !showAssignJobsDialog) ||
      (!(showClientDialog && dialogClients.length === 0) &&
        !(showCreateJob && (dialogClients.length === 0 || dialogMembers.length === 0)) &&
        !(
          showEditDialog &&
          (dialogClients.length === 0 || dialogMembers.length === 0 || dialogAvailableJobs.length === 0)
        ) &&
        !(showAssignJobsDialog && dialogAvailableJobs.length === 0))
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
        setDialogAvailableJobs(result.jobs);
      })
      .catch(() => {
        setDialogOptionsError(DIALOG_OPTIONS_LOAD_FAILED_MESSAGE);
      })
      .finally(() => {
        dialogOptionsRequestInFlightRef.current = false;
        setIsLoadingDialogOptions(false);
      });
  }, [
    dialogAvailableJobs.length,
    dialogClients.length,
    dialogMembers.length,
    dialogOptionsRefreshKey,
    isAdminOrManager,
    showAssignJobsDialog,
    showClientDialog,
    showCreateJob,
    showEditDialog,
  ]);

  return {
    showDeleteDialog,
    setShowDeleteDialog,
    showCreateJob,
    setShowCreateJob,
    showEditDialog,
    setShowEditDialog,
    showClientDialog,
    setShowClientDialog,
    showAssignJobsDialog,
    setShowAssignJobsDialog,
    dialogClients,
    dialogMembers,
    dialogAvailableJobs,
    setDialogAvailableJobs,
    isLoadingDialogOptions,
    dialogOptionsError,
    setDialogOptionsRefreshKey,
  };
}

export type ProjectDetailDialogState = ReturnType<typeof useProjectDetailDialogState>;
