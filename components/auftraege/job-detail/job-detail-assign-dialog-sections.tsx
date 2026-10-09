'use client';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { EmployeeMultiSelect, type OrgMemberOption } from '../shared/employee-multi-select';
import type { JobDetailAssignments } from './use-job-detail-assignments';

type JobDetailAssignDialogBodyProps = {
  assignment: JobDetailAssignments;
  members: OrgMemberOption[];
  assessedForDate: string | null;
};

function JobDetailAssignDialogBody({ assignment, members, assessedForDate }: JobDetailAssignDialogBodyProps) {
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
        members={members}
        selectedIds={assignSelectedIds}
        onSelectionChange={setAssignSelectedIds}
        assessedForDate={assessedForDate}
        onTeamApplied={setAssignmentTeamSourceId}
        onTeamExpansionPendingChange={setIsExpandingAssignmentTeam}
      />
      <ErrorText className="mt-3">{assignError}</ErrorText>
    </div>
  );
}

type JobDetailAssignDialogFooterProps = {
  assignment: JobDetailAssignments;
  setShowAssignDialog: (open: boolean) => void;
};

function JobDetailAssignDialogFooter({ assignment, setShowAssignDialog }: JobDetailAssignDialogFooterProps) {
  const { isAssigning, isExpandingAssignmentTeam, handleAssignEmployees } = assignment;

  return (
    <DialogFooter>
      <Button variant="outline" onClick={() => setShowAssignDialog(false)} disabled={isAssigning}>
        Abbrechen
      </Button>
      <Button
        pending={isAssigning}
        onClick={handleAssignEmployees}
        disabled={isAssigning || isExpandingAssignmentTeam}
      >
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
  const { assignment } = bodyProps;
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
        <JobDetailAssignDialogFooter assignment={assignment} setShowAssignDialog={setShowAssignDialog} />
      </DialogContent>
    </Dialog>
  );
}
