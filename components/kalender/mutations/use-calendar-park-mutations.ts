'use client';

import { useCallback } from 'react';
import {
  isPlanningWarning,
  saveUntilPlanningSettled,
} from '@/components/auftraege/forms/planning-warning-result';
import { calendarActionResult } from '@/lib/calendar/action-result';
import type { CalendarRefusalContext } from '@/lib/calendar/messages';
import { unparkPlacement, type UnparkPlacement, type UnparkRequest } from '@/lib/calendar/visit-placement';
import type { CalendarJob, UpdateJobResult } from '@/lib/jobs/types';
import type { AssignmentApproval } from '@/lib/qualifications/types';
import { parkWorkTarget, unparkJobIntoSchedule } from '@/lib/work-lifecycle/actions';
import type { ActionResult } from '@/lib/action-result';
import type { OptimisticOperation } from './use-optimistic-run';
import type { MutationFeedback } from './use-mutation-feedback';
import type { UseCalendarMutationsOptions } from './use-calendar-mutations';

type ParkMutationInput = Pick<
  UseCalendarMutationsOptions,
  | 'beginMutation'
  | 'updateJobs'
  | 'updateParkedJobs'
  | 'jobsRef'
  | 'showBanner'
  | 'requestApproval'
  | 'requestPlanningApproval'
  | 'silentRefresh'
> & {
  feedback: MutationFeedback;
  run: (operation: OptimisticOperation) => Promise<boolean>;
};

function useBeginPark({
  beginMutation,
  updateJobs,
  updateParkedJobs,
  jobsRef,
  showBanner,
  silentRefresh,
  feedback,
}: ParkMutationInput) {
  const { announce, lastUndoRef } = feedback;
  /**
   * Park by drag: the card leaves the grid now and the context dialog owns
   * the write. Returns the release for the dialog's outcome: `saved` keeps
   * the placement and offers Undo, `cancelled` and `failed` restore it.
   */
  return useCallback(
    (job: CalendarJob) => {
      const jobId = job.jobId ?? job.id;
      const originalVisits = jobsRef.current.filter((entry) => (entry.jobId ?? entry.id) === jobId);
      const release = beginMutation();
      lastUndoRef.current = null;
      const parkedCard: CalendarJob = {
        ...job,
        id: jobId,
        occurrenceId: undefined,
        jobId,
        status: 'geparkt',
        plannedDate: null,
        plannedTime: null,
      };
      updateJobs((previous) => previous.filter((entry) => (entry.jobId ?? entry.id) !== jobId));
      updateParkedJobs((previous) =>
        previous.some((entry) => entry.id === jobId) ? previous : [parkedCard, ...previous],
      );
      const restore = () => {
        updateParkedJobs((previous) => previous.filter((entry) => entry.id !== jobId));
        updateJobs((previous) => [
          ...previous,
          ...originalVisits.filter((original) => !previous.some((entry) => entry.id === original.id)),
        ]);
      };
      return {
        cancelled: () => {
          restore();
          release();
        },
        failed: () => {
          restore();
          release();
          silentRefresh();
        },
        saved: (undoUnpark: () => Promise<void>) => {
          release();
          announce('Auftrag wurde geparkt.');
          lastUndoRef.current = () => {
            void undoUnpark();
          };
          showBanner({
            variant: 'success',
            message: 'Auftrag wurde geparkt.',
            actionLabel: 'Rückgängig',
            onAction: () => {
              lastUndoRef.current = null;
              void undoUnpark();
            },
          });
        },
      };
    },
    [announce, beginMutation, jobsRef, showBanner, silentRefresh, updateJobs, updateParkedJobs, lastUndoRef],
  );
}

/** What an unpark sends apart from the approvals its warnings ask for. */
type UnparkScheduleInput = {
  jobId: string;
  blockerVersion: number;
  reason: string;
  schedule: UnparkPlacement['schedule'];
};

/**
 * The unpark's one server call with its warnings: after a qualification
 * warning the same call with the approval, after a planning warning with the
 * reason. Each warning changed nothing, so a declined one leaves the job parked.
 */
async function unparkWithApprovals(
  unpark: UnparkScheduleInput,
  {
    requestApproval,
    requestPlanningApproval,
    isScopeActive,
  }: Pick<ParkMutationInput, 'requestApproval' | 'requestPlanningApproval'> & {
    isScopeActive: () => boolean;
  },
): Promise<UpdateJobResult> {
  const declined: UpdateJobResult = { success: false, error: 'qualification_declined' };
  const unparkWithReasons = async (
    assignmentApproval: AssignmentApproval | null,
  ): Promise<UpdateJobResult> => {
    const result = await saveUntilPlanningSettled(
      (planningApproval) => unparkJobIntoSchedule({ ...unpark, assignmentApproval, planningApproval }),
      async (conflicts, fingerprint) => {
        const approval = await requestPlanningApproval(conflicts, fingerprint);
        return approval && isScopeActive() ? approval : null;
      },
    );
    return isPlanningWarning(result) ? declined : result;
  };
  const result = await unparkWithReasons(null);
  if (
    !result.success &&
    (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
    'evaluation' in result
  ) {
    const approval = await requestApproval(result.evaluation);
    if (!approval || !isScopeActive()) return declined;
    return unparkWithReasons(approval);
  }
  return result;
}

function useUnparkJob({
  updateJobs,
  updateParkedJobs,
  jobsRef,
  requestApproval,
  requestPlanningApproval,
  feedback,
  run,
}: ParkMutationInput) {
  const { isScopeActive } = feedback;
  /**
   * Unpark by drag: one server call; after a qualification warning the same
   * call with the approval, after a planning warning with the reason.
   */
  return useCallback(
    (input: UnparkRequest & { successMessage: string; context?: CalendarRefusalContext | undefined }) => {
      const { job, parkingContext } = input;
      const { jobId, placed, schedule, restoreContext } = unparkPlacement(input);
      const execute = async (): Promise<ActionResult> =>
        calendarActionResult(async () => {
          const unpark = {
            jobId,
            blockerVersion: parkingContext.version,
            reason: 'Im Kalender neu eingeplant',
            schedule,
          };
          return unparkWithApprovals(unpark, { requestApproval, requestPlanningApproval, isScopeActive });
        });
      return run({
        apply: () => {
          updateParkedJobs((previous) => previous.filter((entry) => entry.id !== jobId));
          updateJobs((previous) => [...previous.filter((entry) => entry.id !== jobId), placed]);
        },
        revert: () => {
          updateJobs((previous) => previous.filter((entry) => entry.id !== jobId));
          updateParkedJobs((previous) =>
            previous.some((entry) => entry.id === jobId) ? previous : [job, ...previous],
          );
        },
        execute,
        undo: restoreContext
          ? () =>
              calendarActionResult(() =>
                parkWorkTarget({
                  targetType: 'job',
                  targetId: jobId,
                  expectedExecutionVersion:
                    jobsRef.current.find((entry) => entry.id === jobId)?.executionVersion ??
                    job.executionVersion ??
                    0,
                  ...restoreContext,
                }),
              )
          : undefined,
        successMessage: input.successMessage,
        context: input.context,
      });
    },
    [isScopeActive, jobsRef, requestApproval, requestPlanningApproval, run, updateJobs, updateParkedJobs],
  );
}

/**
 * Parking from the grid. Park by drag hands the write to the context dialog
 * and returns the release for its outcome; unpark by drag is one server call
 * whose warning changes nothing and is repeated with the approval or reason.
 */
export function useCalendarParkMutations(input: ParkMutationInput) {
  const beginPark = useBeginPark(input);
  const unparkJob = useUnparkJob(input);
  return { beginPark, unparkJob };
}
