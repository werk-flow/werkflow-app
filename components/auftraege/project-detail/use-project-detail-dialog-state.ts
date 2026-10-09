'use client';

import { useState } from 'react';

/** Which project dialog is open. Every dialog searches its own choices on the server. */
export function useProjectDetailDialogState() {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showCreateJob, setShowCreateJob] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [showAssignJobsDialog, setShowAssignJobsDialog] = useState(false);

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
  };
}

export type ProjectDetailDialogState = ReturnType<typeof useProjectDetailDialogState>;
