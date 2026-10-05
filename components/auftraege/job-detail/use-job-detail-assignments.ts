'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { useBusyIds } from '@/hooks/use-busy-id';
import { usePendingTask } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { updateJobAssignments } from '@/lib/jobs/actions';
import type { Job, JobWithDetails } from '@/lib/jobs/types';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import {
  appendOptimisticJobAssignments,
  removeJobAssignment,
  replaceJobAssignmentsAfterEdit,
} from './job-detail-assignment-updates';

type JobDetailQualificationOverrideInput = {
  jobId: string;
  assignmentTeamSourceId: string | null;
  onSaved: () => void;
};

/** The reasoned override of a qualification warning raised by an assignment change. */
function useJobDetailQualificationOverride({
  jobId,
  assignmentTeamSourceId,
  onSaved,
}: JobDetailQualificationOverrideInput) {
  const router = useRouter();
  const [qualificationOverrideError, setQualificationOverrideError] = useState<string | null>(null);
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const [pendingAssignmentIds, setPendingAssignmentIds] = useState<string[]>([]);
  const [isQualificationOverrideSaving, setIsQualificationOverrideSaving] = useState(false);

  const requestQualificationOverride = (nextIds: string[], evaluation: AssignmentEvaluation) => {
    setPendingAssignmentIds(nextIds);
    setQualificationWarning(evaluation);
  };

  const handleQualificationOverride = async (approval: AssignmentApproval) => {
    setIsQualificationOverrideSaving(true);
    setQualificationOverrideError(null);
    try {
      const result = await updateJobAssignments(
        jobId,
        pendingAssignmentIds,
        approval,
        assignmentTeamSourceId,
      );
      if (!result.success) {
        if (
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          setQualificationWarning(result.evaluation);
        } else {
          setQualificationOverrideError('Die begründete Zuweisung konnte nicht gespeichert werden.');
        }
        return;
      }
      setQualificationWarning(null);
      setPendingAssignmentIds([]);
      onSaved();
      router.refresh();
    } catch {
      setQualificationOverrideError('Die begründete Zuweisung konnte nicht gespeichert werden.');
    } finally {
      setIsQualificationOverrideSaving(false);
    }
  };

  const cancelQualificationWarning = () => {
    setQualificationWarning(null);
    setPendingAssignmentIds([]);
    setQualificationOverrideError(null);
  };

  return {
    qualificationWarning,
    qualificationOverrideError,
    isQualificationOverrideSaving,
    requestQualificationOverride,
    handleQualificationOverride,
    cancelQualificationWarning,
  };
}

type JobDetailAssignmentsInput = {
  liveJob: JobWithDetails;
  setLiveJob: Dispatch<SetStateAction<JobWithDetails>>;
  dialogMembers: OrgMemberOption[];
  setShowAssignDialog: (open: boolean) => void;
};

/** Assigning and unassigning employees on the job detail page. */
export function useJobDetailAssignments({
  liveJob,
  setLiveJob,
  dialogMembers,
  setShowAssignDialog,
}: JobDetailAssignmentsInput) {
  const { showBanner } = useBanner();
  const [assignError, setAssignError] = useState<string | null>(null);
  const { run: runUnassign, isBusy: isUnassigning } = useBusyIds();
  const [assignSelectedIds, setAssignSelectedIds] = useState<string[]>([]);
  const [assignmentTeamSourceId, setAssignmentTeamSourceId] = useState<string | null>(null);
  const [isExpandingAssignmentTeam, setIsExpandingAssignmentTeam] = useState(false);
  const { run: runAssignTask, isPending: isAssigning } = usePendingTask();
  const { requestQualificationOverride, ...qualificationOverride } = useJobDetailQualificationOverride({
    jobId: liveJob.id,
    assignmentTeamSourceId,
    onSaved: () => {
      setShowAssignDialog(false);
      setAssignSelectedIds([]);
      setAssignmentTeamSourceId(null);
    },
  });

  const handleAssignEmployees = () => {
    setAssignError(null);
    void runAssignTask(async () => {
      // The dialog opens with the current crew selected, so its selection is
      // the complete set: an unchecked assignee is removed.
      const nextIds = [...new Set(assignSelectedIds)];
      const newIds = nextIds.filter((id) => !liveJob.assignments.some((a) => a.userId === id));
      let result: Awaited<ReturnType<typeof updateJobAssignments>>;
      try {
        result = await updateJobAssignments(liveJob.id, nextIds, null, assignmentTeamSourceId);
      } catch {
        setAssignError('Die Zuweisung konnte nicht gespeichert werden.');
        return;
      }
      if (!result.success) {
        if (
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          requestQualificationOverride(nextIds, result.evaluation);
        } else {
          setAssignError('Die Zuweisung konnte nicht gespeichert werden.');
        }
        return;
      }
      const keptIds = new Set(nextIds);
      const memberLookup = new Map(dialogMembers.map((member) => [member.userId, member]));
      setLiveJob((current) => {
        const withoutRemoved = current.assignments
          .filter((assignment) => !keptIds.has(assignment.userId))
          .reduce((job, assignment) => removeJobAssignment(job, assignment.userId), current);
        return appendOptimisticJobAssignments(withoutRemoved, newIds, memberLookup);
      });

      setShowAssignDialog(false);
      setAssignSelectedIds([]);
      setAssignmentTeamSourceId(null);
    });
  };

  const handleUnassign = async (userId: string) => {
    const nextIds = liveJob.assignments.map((assignment) => assignment.userId).filter((id) => id !== userId);
    let result: Awaited<ReturnType<typeof updateJobAssignments>>;
    try {
      result = await runUnassign(userId, () => updateJobAssignments(liveJob.id, nextIds));
    } catch {
      showBanner({ variant: 'error', message: 'Die Zuweisung konnte nicht gespeichert werden.' });
      return;
    }
    if (
      !result.success &&
      (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
      'evaluation' in result
    ) {
      requestQualificationOverride(nextIds, result.evaluation);
      return;
    }
    if (!result.success) {
      showBanner({ variant: 'error', message: 'Die Zuweisung konnte nicht gespeichert werden.' });
      return;
    }
    setLiveJob((current) => removeJobAssignment(current, userId));
  };

  const handleJobEdited = ({
    job: updatedJob,
    selectedEmployeeIds,
  }: {
    job: Job;
    selectedEmployeeIds?: string[];
  }) => {
    const selectedIds = new Set(selectedEmployeeIds ?? []);
    const memberLookup = new Map(dialogMembers.map((member) => [member.userId, member]));
    setLiveJob((current) => replaceJobAssignmentsAfterEdit(current, updatedJob, selectedIds, memberLookup));
  };

  const openAssignDialog = () => {
    setAssignSelectedIds(liveJob.assignments.map((a) => a.userId));
    setAssignmentTeamSourceId(null);
    setShowAssignDialog(true);
  };

  const handleAssignDialogOpenChange = (open: boolean) => {
    setShowAssignDialog(open);
    if (!open) {
      setAssignmentTeamSourceId(null);
      setIsExpandingAssignmentTeam(false);
      setAssignError(null);
    }
  };

  return {
    ...qualificationOverride,
    assignError,
    assignSelectedIds,
    setAssignSelectedIds,
    setAssignmentTeamSourceId,
    isExpandingAssignmentTeam,
    setIsExpandingAssignmentTeam,
    isAssigning,
    isUnassigning,
    openAssignDialog,
    handleAssignDialogOpenChange,
    handleAssignEmployees,
    handleUnassign,
    handleJobEdited,
  };
}

export type JobDetailAssignments = ReturnType<typeof useJobDetailAssignments>;
