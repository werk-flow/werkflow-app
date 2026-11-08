'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import { useBusyIds } from '@/hooks/use-busy-id';
import { usePendingTask, useServerAction } from '@/hooks/use-server-action';
import { useBanner } from '@/components/ui/banner';
import { usePlanningWarningConfirmation } from '@/components/kalender/planning-warning-dialog';
import { updateJobAssignments } from '@/lib/jobs/actions';
import type { Job, JobWithDetails, UpdateJobAssignmentsResult } from '@/lib/jobs/types';
import type { PlanningConflictApproval } from '@/lib/planning/conflict-acknowledgement';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import type { OrgMemberOption } from '../shared/employee-multi-select';
import {
  appendOptimisticJobAssignments,
  removeJobAssignment,
  replaceJobAssignmentsAfterEdit,
} from './job-detail-assignment-updates';

/** The save's refusal in German: a team changed by someone else, or any other failure. */
function assignmentFailureMessage(error: string, fallback: string): string {
  return error === 'assignments_changed'
    ? 'Die Zuweisung wurde inzwischen geändert. Prüfe die Auswahl und speichere erneut.'
    : fallback;
}

type RequestPlanningApproval = ReturnType<typeof usePlanningWarningConfirmation>['requestApproval'];

/**
 * Saves the selection; while the server reports planning conflicts on the
 * job's visit, asks for the reason of that exact assessment and saves again.
 * Null when the manager takes the change back.
 */
async function saveWithPlanningApproval(
  save: (planningApproval: PlanningConflictApproval | null) => Promise<UpdateJobAssignmentsResult>,
  requestPlanningApproval: RequestPlanningApproval,
): Promise<UpdateJobAssignmentsResult | null> {
  let result = await save(null);
  while (!result.success && 'conflicts' in result) {
    const approval = await requestPlanningApproval(result.conflicts, result.fingerprint);
    if (!approval) return null;
    result = await save(approval);
  }
  return result;
}

type JobDetailQualificationOverrideInput = {
  jobId: string;
  assignmentTeamSourceId: string | null;
  onSaved: () => void;
};

/**
 * The reasoned overrides of an assignment change: a qualification gap on the
 * job, and planning conflicts on the visit it reaches.
 */
function useJobDetailAssignmentOverrides({
  jobId,
  assignmentTeamSourceId,
  onSaved,
}: JobDetailQualificationOverrideInput) {
  const { requestApproval: requestPlanningApproval, warningDialog: planningWarningDialog } =
    usePlanningWarningConfirmation();
  const [qualificationOverrideError, setQualificationOverrideError] = useState<string | null>(null);
  const [qualificationWarning, setQualificationWarning] = useState<AssignmentEvaluation | null>(null);
  const [pendingAssignmentIds, setPendingAssignmentIds] = useState<string[]>([]);
  const { run: runOverride, isPending: isQualificationOverrideSaving } =
    useServerAction(updateJobAssignments);

  const requestQualificationOverride = (nextIds: string[], evaluation: AssignmentEvaluation) => {
    setPendingAssignmentIds(nextIds);
    setQualificationWarning(evaluation);
  };

  const handleQualificationOverride = async (approval: AssignmentApproval) => {
    setQualificationOverrideError(null);
    try {
      const result = await saveWithPlanningApproval(
        (planningApproval) =>
          runOverride(jobId, pendingAssignmentIds, approval, assignmentTeamSourceId, planningApproval),
        requestPlanningApproval,
      );
      // Taken back in the planning dialog: the qualification dialog stays open.
      if (!result) return;
      if (!result.success) {
        if (
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          setQualificationWarning(result.evaluation);
        } else {
          setQualificationOverrideError(
            assignmentFailureMessage(
              result.error,
              'Die begründete Zuweisung konnte nicht gespeichert werden.',
            ),
          );
        }
        return;
      }
      setQualificationWarning(null);
      setPendingAssignmentIds([]);
      // The action's response renders the route with the new assignments.
      onSaved();
    } catch {
      setQualificationOverrideError('Die begründete Zuweisung konnte nicht gespeichert werden.');
    }
  };

  const cancelQualificationWarning = () => {
    setQualificationWarning(null);
    setPendingAssignmentIds([]);
    setQualificationOverrideError(null);
  };

  return {
    requestPlanningApproval,
    planningWarningDialog,
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

type RequestQualificationOverride = (nextIds: string[], evaluation: AssignmentEvaluation) => void;

type SaveJobDetailAssignmentsInput = Pick<
  JobDetailAssignmentsInput,
  'liveJob' | 'setLiveJob' | 'dialogMembers'
> & {
  assignSelectedIds: string[];
  assignmentTeamSourceId: string | null;
  setAssignError: (error: string | null) => void;
  requestQualificationOverride: RequestQualificationOverride;
  requestPlanningApproval: RequestPlanningApproval;
  onSaved: () => void;
};

/** Saves the dialog's selection as the job's complete crew, then patches the shown assignments. */
async function saveJobDetailAssignments({
  liveJob,
  setLiveJob,
  dialogMembers,
  assignSelectedIds,
  assignmentTeamSourceId,
  setAssignError,
  requestQualificationOverride,
  requestPlanningApproval,
  onSaved,
}: SaveJobDetailAssignmentsInput) {
  // The dialog opens with the current crew selected, so its selection is
  // the complete set: an unchecked assignee is removed.
  const nextIds = [...new Set(assignSelectedIds)];
  const newIds = nextIds.filter((id) => !liveJob.assignments.some((a) => a.userId === id));
  let result: UpdateJobAssignmentsResult | null;
  try {
    result = await saveWithPlanningApproval(
      (planningApproval) =>
        updateJobAssignments(liveJob.id, nextIds, null, assignmentTeamSourceId, planningApproval),
      requestPlanningApproval,
    );
  } catch {
    setAssignError('Die Zuweisung konnte nicht gespeichert werden.');
    return;
  }
  // Taken back in the planning dialog: the selection stays open for a change.
  if (!result) return;
  if (!result.success) {
    if (
      (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
      'evaluation' in result
    ) {
      requestQualificationOverride(nextIds, result.evaluation);
    } else {
      setAssignError(
        assignmentFailureMessage(result.error, 'Die Zuweisung konnte nicht gespeichert werden.'),
      );
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

  onSaved();
}

type UnassignJobDetailEmployeeInput = Pick<JobDetailAssignmentsInput, 'liveJob' | 'setLiveJob'> & {
  userId: string;
  runUnassign: ReturnType<typeof useBusyIds>['run'];
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  requestQualificationOverride: RequestQualificationOverride;
};

/** Removes one employee from the job; a qualification refusal asks for the reasoned override. */
async function unassignJobDetailEmployee({
  userId,
  liveJob,
  setLiveJob,
  runUnassign,
  showBanner,
  requestQualificationOverride,
}: UnassignJobDetailEmployeeInput) {
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
}

type EditedJob = { job: Job; selectedEmployeeIds?: string[] };

/** Takes the edit dialog's saved job and crew into the shown job. */
function applyEditedJobAssignments({
  edit: { job: updatedJob, selectedEmployeeIds },
  dialogMembers,
  setLiveJob,
}: Pick<JobDetailAssignmentsInput, 'dialogMembers' | 'setLiveJob'> & { edit: EditedJob }) {
  const selectedIds = new Set(selectedEmployeeIds ?? []);
  const memberLookup = new Map(dialogMembers.map((member) => [member.userId, member]));
  setLiveJob((current) => replaceJobAssignmentsAfterEdit(current, updatedJob, selectedIds, memberLookup));
}

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
  const closeSavedAssignDialog = () => {
    setShowAssignDialog(false);
    setAssignSelectedIds([]);
    setAssignmentTeamSourceId(null);
  };
  const { requestQualificationOverride, requestPlanningApproval, ...overrides } =
    useJobDetailAssignmentOverrides({
      jobId: liveJob.id,
      assignmentTeamSourceId,
      onSaved: closeSavedAssignDialog,
    });

  const handleAssignEmployees = () => {
    setAssignError(null);
    void runAssignTask(() =>
      saveJobDetailAssignments({
        liveJob,
        setLiveJob,
        dialogMembers,
        assignSelectedIds,
        assignmentTeamSourceId,
        setAssignError,
        requestQualificationOverride,
        requestPlanningApproval,
        onSaved: closeSavedAssignDialog,
      }),
    );
  };

  const handleUnassign = (userId: string) =>
    unassignJobDetailEmployee({
      userId,
      liveJob,
      setLiveJob,
      runUnassign,
      showBanner,
      requestQualificationOverride,
    });

  const handleJobEdited = (edit: EditedJob) => applyEditedJobAssignments({ edit, dialogMembers, setLiveJob });

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
    ...overrides,
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
