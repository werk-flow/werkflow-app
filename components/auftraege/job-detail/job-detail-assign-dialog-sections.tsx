'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeMultiSelect, type OrgMemberOption } from '../shared/employee-multi-select';
import { OptionsLoadError } from '../shared/options-load-error';
import type { JobDetailAssignments } from './use-job-detail-assignments';

type JobDetailAssignDialogBodyProps = {
  assignment: JobDetailAssignments;
  dialogMembers: OrgMemberOption[];
  assessedForDate: string | null;
  isLoadingDialogOptions: boolean;
  dialogOptionsError: string | null;
  retryDialogOptions: () => void;
};

function JobDetailAssignDialogBody({
  assignment,
  dialogMembers,
  assessedForDate,
  isLoadingDialogOptions,
  dialogOptionsError,
  retryDialogOptions,
}: JobDetailAssignDialogBodyProps) {
  const {
    assignSelectedIds,
    setAssignSelectedIds,
    setAssignmentTeamSourceId,
    setIsExpandingAssignmentTeam,
    assignError,
  } = assignment;

  return (
    <div className="py-4">
      <EmployeeMultiSelect
        members={dialogMembers}
        selectedIds={assignSelectedIds}
        onSelectionChange={setAssignSelectedIds}
        assessedForDate={assessedForDate}
        onTeamApplied={setAssignmentTeamSourceId}
        onTeamExpansionPendingChange={setIsExpandingAssignmentTeam}
      />
      {isLoadingDialogOptions && (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      )}
      <div className="mt-3">
        <OptionsLoadError
          error={dialogOptionsError}
          onRetry={retryDialogOptions}
          retrying={isLoadingDialogOptions}
        />
      </div>
      <ErrorText className="mt-3">{assignError}</ErrorText>
    </div>
  );
}

type JobDetailAssignDialogFooterProps = {
  assignment: JobDetailAssignments;
  isLoadingDialogOptions: boolean;
  setShowAssignDialog: (open: boolean) => void;
};

function JobDetailAssignDialogFooter({
  assignment,
  isLoadingDialogOptions,
  setShowAssignDialog,
}: JobDetailAssignDialogFooterProps) {
  const { isAssigning, isExpandingAssignmentTeam, handleAssignEmployees } = assignment;

  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => setShowAssignDialog(false)} disabled={isAssigning}>
        Abbrechen
      </Button>
      <Button
        onClick={handleAssignEmployees}
        disabled={isAssigning || isLoadingDialogOptions || isExpandingAssignmentTeam}
      >
        {isAssigning && <Loader2 className="mr-2 size-4 animate-spin" />}
        Speichern
      </Button>
    </DialogFooter>
  );
}

/** The „Mitarbeiter zuweisen“ dialog; it stays open while the assignment saves. */
export function JobDetailAssignDialog({
  open,
  setShowAssignDialog,
  ...bodyProps
}: JobDetailAssignDialogBodyProps & { open: boolean; setShowAssignDialog: (open: boolean) => void }) {
  const { assignment, isLoadingDialogOptions } = bodyProps;
  return (
    <Dialog
      open={open}
      onOpenChange={assignment.handleAssignDialogOpenChange}
      pending={assignment.isAssigning || assignment.isExpandingAssignmentTeam}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Mitarbeiter zuweisen</DialogTitle>
        </DialogHeader>
        <JobDetailAssignDialogBody {...bodyProps} />
        <JobDetailAssignDialogFooter
          assignment={assignment}
          isLoadingDialogOptions={isLoadingDialogOptions}
          setShowAssignDialog={setShowAssignDialog}
        />
      </DialogContent>
    </Dialog>
  );
}
