'use client';

import { useCallback } from 'react';
import { calendarActionResult } from '@/lib/calendar/action-result';
import type { CalendarRefusalContext } from '@/lib/calendar/messages';
import { unparkPlacement, type UnparkRequest } from '@/lib/calendar/visit-placement';
import type { CalendarJob } from '@/lib/jobs/types';
import { parkWorkTarget, unparkJobIntoSchedule } from '@/lib/work-lifecycle/actions';
import type { ActionResult, OptimisticOperation } from './use-optimistic-run';
import type { MutationFeedback } from './use-mutation-feedback';
import type { UseCalendarMutationsOptions } from './use-calendar-mutations';

/**
 * Parking from the grid. Park by drag hands the write to the context dialog
 * and returns the release for its outcome; unpark by drag is one server call
 * whose warning changes nothing and is repeated with the approval.
 */
export function useCalendarParkMutations({
  beginMutation,
  updateJobs,
  updateParkedJobs,
  jobsRef,
  showBanner,
  requestApproval,
  silentRefresh,
  feedback,
  run,
}: Pick<
  UseCalendarMutationsOptions,
  | 'beginMutation'
  | 'updateJobs'
  | 'updateParkedJobs'
  | 'jobsRef'
  | 'showBanner'
  | 'requestApproval'
  | 'silentRefresh'
> & {
  feedback: MutationFeedback;
  run: (operation: OptimisticOperation) => Promise<boolean>;
}) {
  const { announce, isScopeActive, lastUndoRef } = feedback;
  /**
   * Park by drag: the card leaves the grid now and the context dialog owns
   * the write. Returns the release for the dialog's outcome: `saved` keeps
   * the placement and offers Undo, `cancelled` and `failed` restore it.
   */
  const beginPark = useCallback(
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

  /** Unpark by drag: one server call; after a qualification warning the same call with the approval. */
  const unparkJob = useCallback(
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
          const result = await unparkJobIntoSchedule(unpark);
          if (result.success) return result;
          if (
            (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
            'evaluation' in result
          ) {
            // The warning changed nothing: the job is still parked.
            const approval = await requestApproval(result.evaluation);
            if (!approval || !isScopeActive()) {
              return { success: false as const, error: 'qualification_declined' };
            }
            return unparkJobIntoSchedule({ ...unpark, assignmentApproval: approval });
          }
          return result;
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
    [isScopeActive, jobsRef, requestApproval, run, updateJobs, updateParkedJobs],
  );

  return { beginPark, unparkJob };
}
