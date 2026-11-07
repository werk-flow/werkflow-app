'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ErrorText } from '@/components/ui/error-text';
import { Field } from '@/components/ui/field';
import { SectionError } from '@/components/ui/section-error';
import { readInBackground } from '@/lib/data/background-read-client';
import { EmployeeMultiSelect, type OrgMemberOption } from '../shared/employee-multi-select';
import type { JobDetailAssignments } from './use-job-detail-assignments';

type AvailabilityRead =
  | { state: 'loading' }
  | { state: 'loaded'; notes: ReadonlyMap<string, string> }
  | { state: 'failed' };

/**
 * Who cannot be planned on the visit date (left, not yet started, app access
 * ended), read while the dialog is open. The save checks the same facts on
 * the server, so a failed read only loses the marks.
 */
function useAssignmentAvailability(open: boolean, localDate: string | null) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${localDate ?? 'heute'}:${attempt}`;
  const [settled, setSettled] = useState<{ key: string; read: AvailabilityRead } | null>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void readInBackground('assignment-availability', { localDate }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setSettled({
        key: requestKey,
        read: result.success
          ? { state: 'loaded', notes: new Map(result.notes.map((entry) => [entry.userId, entry.note])) }
          : { state: 'failed' },
      });
    });
    return () => controller.abort();
  }, [open, localDate, requestKey]);
  const read: AvailabilityRead = settled?.key === requestKey ? settled.read : { state: 'loading' };
  return { read, retry: () => setAttempt((count) => count + 1) };
}

type JobDetailAssignDialogBodyProps = {
  assignment: JobDetailAssignments;
  members: OrgMemberOption[];
  assessedForDate: string | null;
};

function JobDetailAssignDialogBody({
  assignment,
  members,
  assessedForDate,
  open,
}: JobDetailAssignDialogBodyProps & { open: boolean }) {
  const availability = useAssignmentAvailability(open, assessedForDate);
  const {
    assignSelectedIds,
    setAssignSelectedIds,
    setAssignmentTeamSourceId,
    setIsExpandingAssignmentTeam,
    assignError,
  } = assignment;

  return (
    <div className="py-4">
      <Field label="Mitarbeiter">
        <EmployeeMultiSelect
          members={members}
          selectedIds={assignSelectedIds}
          onSelectionChange={setAssignSelectedIds}
          assessedForDate={assessedForDate}
          onTeamApplied={setAssignmentTeamSourceId}
          onTeamExpansionPendingChange={setIsExpandingAssignmentTeam}
          memberNotes={availability.read.state === 'loaded' ? availability.read.notes : undefined}
        />
      </Field>
      {availability.read.state === 'failed' && (
        <SectionError onRetry={availability.retry}>
          Austritte und beendete App-Zugänge konnten nicht geladen werden. Beim Speichern prüft WerkFlow sie
          trotzdem.
        </SectionError>
      )}
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
        <JobDetailAssignDialogBody {...bodyProps} open={open} />
        <JobDetailAssignDialogFooter assignment={assignment} setShowAssignDialog={setShowAssignDialog} />
      </DialogContent>
    </Dialog>
  );
}
