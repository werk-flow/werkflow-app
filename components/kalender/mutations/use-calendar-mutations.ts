'use client';

import { useCallback, useMemo, useState } from 'react';
import type { CalendarJob } from '@/lib/jobs/types';
import type { CalendarTimeCorrectionDraft } from '@/lib/time-corrections/calendar-draft';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import type { PlanningConflict } from '@/lib/planning/types';
import { useMutationFeedback } from './use-mutation-feedback';
import { useOptimisticRun } from './use-optimistic-run';
import { useCalendarVisitWrites } from './use-calendar-visit-writes';
import { useCalendarParkMutations } from './use-calendar-park-mutations';

/**
 * The calendar's one optimistic owner for planning (P1-24a, criterion 26). Each planning drop and
 * command runs through `run`: take mutation ownership, apply the intended
 * result to the range owner, call the existing action, and on failure roll
 * back with the sentence from the message layer; on success show the banner
 * with Undo, which reverses through the same path. The settle read after the
 * release is the truth. Recorded-time gestures only open a correction draft;
 * the audited correction form owns submission. Nothing here knows a view.
 */

export type UseCalendarMutationsOptions = {
  beginMutation: () => () => void;
  updateJobs: (update: (previous: CalendarJob[]) => CalendarJob[]) => void;
  updateParkedJobs: (update: (previous: CalendarJob[]) => CalendarJob[]) => void;
  jobsRef: React.RefObject<CalendarJob[]>;
  showBanner: (banner: {
    variant: 'success' | 'error' | 'info' | 'progress';
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => () => void;
  isScopeActive: () => boolean;
  requestApproval: (evaluation: AssignmentEvaluation) => Promise<AssignmentApproval | null>;
  requestPlanningApproval: (
    conflicts: PlanningConflict[],
    fingerprint: string,
  ) => Promise<{ fingerprint: string; reason: string } | null>;
  /** Refreshes without ownership; used after an undo whose outcome is unknown. */
  silentRefresh: () => void;
};

export function useCalendarMutations(options: UseCalendarMutationsOptions) {
  const {
    beginMutation,
    updateJobs,
    updateParkedJobs,
    jobsRef,
    showBanner,
    isScopeActive: isCallerScopeActive,
    requestApproval,
    requestPlanningApproval,
    silentRefresh,
  } = options;
  const feedback = useMutationFeedback({ showBanner, isScopeActive: isCallerScopeActive });
  const { isScopeActive, lastUndoRef } = feedback;
  const run = useOptimisticRun({ beginMutation, showBanner, silentRefresh, feedback });

  /** `z` while the success banner shows: the last reversible operation. */
  const undoLast = useCallback(() => {
    const undo = lastUndoRef.current;
    if (!undo) return false;
    undo();
    return true;
  }, [lastUndoRef]);

  const { writeJob, moveJob, copyJob } = useCalendarVisitWrites({
    updateJobs,
    requestApproval,
    requestPlanningApproval,
    isScopeActive,
    run,
  });

  /** Recorded-time gestures propose an audited correction; they never write raw entries. */
  const [timeCorrectionDraft, setTimeCorrectionDraft] = useState<CalendarTimeCorrectionDraft | null>(null);
  const closeTimeCorrection = useCallback(() => setTimeCorrectionDraft(null), []);
  const moveTimeBlock = useCallback((input: CalendarTimeCorrectionDraft) => {
    setTimeCorrectionDraft(input);
  }, []);
  const resizeTimeBlock = moveTimeBlock;

  const { beginPark, unparkJob } = useCalendarParkMutations({
    beginMutation,
    updateJobs,
    updateParkedJobs,
    jobsRef,
    showBanner,
    requestApproval,
    silentRefresh,
    feedback,
    run,
  });

  return useMemo(
    () => ({
      run,
      moveJob,
      copyJob,
      moveTimeBlock,
      resizeTimeBlock,
      timeCorrectionDraft,
      closeTimeCorrection,
      beginPark,
      unparkJob,
      undoLast,
      writeJob,
    }),
    [
      run,
      moveJob,
      copyJob,
      moveTimeBlock,
      resizeTimeBlock,
      timeCorrectionDraft,
      closeTimeCorrection,
      beginPark,
      unparkJob,
      undoLast,
      writeJob,
    ],
  );
}

export type CalendarMutations = ReturnType<typeof useCalendarMutations>;
