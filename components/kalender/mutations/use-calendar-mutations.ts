'use client';

import { useCallback, useMemo, useRef } from 'react';
import { calendarActionResult } from '@/lib/calendar/action-result';
import { calendarRefusalMessage, calendarUndoFailureMessage, type CalendarRefusalContext } from '@/lib/calendar/messages';
import type { CalendarJob } from '@/lib/jobs/types';
import { updateJob as updateJobAction, type UpdateJobInput } from '@/lib/jobs/actions';
import { createPlanningEntry, updatePlanningCalendarEntry, type UpdatePlanningCalendarInput } from '@/lib/planning/actions';
import { reassignEntryBatch as reassignEntryBatchAction, updateEntry as updateEntryAction } from '@/lib/time-tracking/actions';
import { parkWorkTarget, unparkJobIntoSchedule } from '@/lib/work-lifecycle/actions';
import type { JobParkingContext } from '@/lib/parking/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { AssignmentApproval, AssignmentEvaluation } from '@/lib/qualifications/types';
import { addLocalDays } from '@/lib/planning/date-time';
import type { PlanningConflict } from '@/lib/planning/types';
import { useCalendarAnnounce } from '../surface/live-region';

/**
 * The calendar's one optimistic owner (P1-24a, criterion 26). Every drop and
 * command runs through `run`: take mutation ownership, apply the intended
 * result to the range owner, call the existing action, and on failure roll
 * back with the sentence from the message layer; on success show the banner
 * with Undo, which reverses through the same path. The settle read after the
 * release is the truth. Nothing here knows a view.
 */

type ActionResult = { success: boolean; error?: string | undefined };

export type OptimisticOperation = {
  apply: () => void;
  revert: () => void;
  execute: () => Promise<ActionResult>;
  successMessage: string;
  /** Spoken to assistive technology after success; defaults to the banner text. */
  announce?: string | undefined;
  /** Facts the refusal sentence may name. */
  context?: CalendarRefusalContext | undefined;
  /** The inverse server call; omitted when the change is not reversible. */
  undo?: (() => Promise<ActionResult>) | undefined;
};

export type UseCalendarMutationsOptions = {
  beginMutation: () => () => void;
  updateJobs: (update: (previous: CalendarJob[]) => CalendarJob[]) => void;
  updateEntries: (update: (previous: TimeEntry[]) => TimeEntry[]) => void;
  updateParkedJobs: (update: (previous: CalendarJob[]) => CalendarJob[]) => void;
  jobsRef: React.RefObject<CalendarJob[]>;
  showBanner: (banner: { variant: 'success' | 'error' | 'info'; message: string; actionLabel?: string; onAction?: () => void }) => void;
  isScopeActive: () => boolean;
  requestApproval: (evaluation: AssignmentEvaluation) => Promise<AssignmentApproval | null>;
  requestPlanningApproval: (conflicts: PlanningConflict[], fingerprint: string) => Promise<{ fingerprint: string; reason: string } | null>;
  /** Refreshes without ownership; used after an undo whose outcome is unknown. */
  silentRefresh: () => void;
};

export type MoveJobChanges = {
  plannedDate?: string;
  plannedTime?: string | null;
  estimatedDurationMinutes?: number | null;
  assignedUserIds?: string[];
  assignedEmployeeRecordIds?: string[];
  /** All-day span in days (the bar-edge drag); the end date follows the start. */
  durationDays?: number;
};

function applyChanges(job: CalendarJob, changes: MoveJobChanges): CalendarJob {
  return {
    ...job,
    ...(changes.plannedDate !== undefined ? { plannedDate: changes.plannedDate } : {}),
    ...(changes.plannedTime !== undefined ? { plannedTime: changes.plannedTime } : {}),
    ...(changes.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: changes.estimatedDurationMinutes } : {}),
    ...(changes.assignedUserIds !== undefined ? { assignedUserIds: changes.assignedUserIds } : {}),
    ...(changes.assignedEmployeeRecordIds !== undefined ? { assignedEmployeeRecordIds: changes.assignedEmployeeRecordIds } : {}),
    ...(changes.durationDays !== undefined || changes.plannedDate !== undefined
      ? { endDateExclusive: addLocalDays(changes.plannedDate ?? job.plannedDate ?? '', changes.durationDays ?? daysBetween(job.plannedDate ?? '', job.endDateExclusive)) }
      : {}),
    // A moved timed occurrence keeps its instants coherent for capacity math.
    ...(changes.plannedDate !== undefined || changes.plannedTime !== undefined || changes.estimatedDurationMinutes !== undefined
      ? recomputeInstants(job, changes)
      : {}),
  };
}

function recomputeInstants(job: CalendarJob, changes: MoveJobChanges): Pick<CalendarJob, 'startAt' | 'endAt'> {
  const date = changes.plannedDate ?? job.plannedDate;
  const time = changes.plannedTime === undefined ? job.plannedTime : changes.plannedTime;
  const duration = changes.estimatedDurationMinutes === undefined ? job.estimatedDurationMinutes : changes.estimatedDurationMinutes;
  if (!date || !time || !duration) return { startAt: job.startAt ?? null, endAt: job.endAt ?? null };
  const start = new Date(`${date}T${time}:00`);
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + duration * 60_000).toISOString() };
}

function jobInputFrom(changes: MoveJobChanges): UpdateJobInput {
  return {
    ...(changes.plannedDate !== undefined ? { plannedDate: changes.plannedDate } : {}),
    ...(changes.plannedTime !== undefined ? { plannedTime: changes.plannedTime ?? '' } : {}),
    ...(changes.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: changes.estimatedDurationMinutes } : {}),
    ...(changes.assignedUserIds !== undefined ? { selectedUserIds: changes.assignedUserIds } : {}),
  };
}

export function useCalendarMutations(options: UseCalendarMutationsOptions) {
  const { beginMutation, updateJobs, updateEntries, updateParkedJobs, jobsRef, showBanner, isScopeActive, requestApproval, requestPlanningApproval, silentRefresh } = options;
  const announce = useCalendarAnnounce();
  const lastUndoRef = useRef<(() => void) | null>(null);

  /** The existing job write with the qualification and planning dialogs (unchanged rules). */
  const writeJob = useCallback(
    async (job: CalendarJob, changes: MoveJobChanges): Promise<ActionResult> => calendarActionResult(async () => {
      if (!isScopeActive()) return { success: false as const, error: 'calendar_scope_changed' };
      if (job.occurrenceId) {
        const planningInput: UpdatePlanningCalendarInput = {
          ...(changes.plannedDate !== undefined ? { plannedDate: changes.plannedDate } : {}),
          ...(changes.plannedTime ? { plannedTime: changes.plannedTime } : {}),
          ...(changes.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: changes.estimatedDurationMinutes } : {}),
          ...(changes.durationDays !== undefined ? { durationDays: changes.durationDays } : {}),
          ...(changes.assignedEmployeeRecordIds !== undefined
            ? { selectedEmployeeRecordIds: changes.assignedEmployeeRecordIds }
            : changes.assignedUserIds !== undefined ? { selectedUserIds: changes.assignedUserIds } : {}),
        };
        let result = await updatePlanningCalendarEntry(job.occurrenceId, planningInput);
        if (!result.success && (result.error === 'planning_warning' || result.error === 'stale_assessment') && result.conflicts && result.fingerprint) {
          const approval = await requestPlanningApproval(result.conflicts, result.fingerprint);
          if (!approval || !isScopeActive()) return { success: false as const, error: 'qualification_declined' };
          result = await updatePlanningCalendarEntry(job.occurrenceId, { ...planningInput, overrideReason: approval.reason, assessmentFingerprint: approval.fingerprint });
        }
        return result;
      }
      const input = jobInputFrom(changes);
      let result = await updateJobAction(job.id, input);
      if (!result.success && (result.error === 'qualification_warning' || result.error === 'stale_evaluation') && 'evaluation' in result) {
        const approval = await requestApproval(result.evaluation);
        if (!approval || !isScopeActive()) return { success: false as const, error: 'qualification_declined' };
        result = await updateJobAction(job.id, { ...input, assignmentApproval: approval });
      }
      return result;
    }),
    [isScopeActive, requestApproval, requestPlanningApproval],
  );

  const run = useCallback(async (operation: OptimisticOperation): Promise<boolean> => {
    const release = beginMutation();
    lastUndoRef.current = null;
    try {
      operation.apply();
      const result = await operation.execute();
      if (!isScopeActive()) return false;
      if (!result.success) {
        operation.revert();
        const message = calendarRefusalMessage(result.error ?? 'unexpected_error', operation.context);
        if (message) { showBanner({ variant: 'error', message }); announce(message); }
        return false;
      }
      announce(operation.announce ?? operation.successMessage);
      const undo = operation.undo;
      if (!undo) {
        showBanner({ variant: 'success', message: operation.successMessage });
        return true;
      }
      const runUndo = async () => {
        if (!isScopeActive()) return;
        lastUndoRef.current = null;
        const releaseUndo = beginMutation();
        try {
          operation.revert();
          const undoResult = await calendarActionResult(undo);
          if (!isScopeActive()) return;
          if (!undoResult.success) {
            const message = calendarUndoFailureMessage(undoResult.error ?? 'unexpected_error', operation.context);
            showBanner({ variant: 'error', message });
            announce(message);
            silentRefresh();
            return;
          }
          announce('Rückgängig gemacht.');
        } finally {
          releaseUndo();
        }
      };
      lastUndoRef.current = () => { void runUndo(); };
      showBanner({ variant: 'success', message: operation.successMessage, actionLabel: 'Rückgängig', onAction: () => { void runUndo(); } });
      return true;
    } finally {
      release();
    }
  }, [announce, beginMutation, isScopeActive, showBanner, silentRefresh]);

  /** `z` while the success banner shows: the last reversible operation. */
  const undoLast = useCallback(() => {
    const undo = lastUndoRef.current;
    if (!undo) return false;
    undo();
    return true;
  }, []);

  const setJob = useCallback((jobId: string, next: (job: CalendarJob) => CalendarJob) => {
    updateJobs((previous) => previous.map((job) => (job.id === jobId ? next(job) : job)));
  }, [updateJobs]);

  /** Move, resize or reassign one visit; the inverse restores every changed field. */
  const moveJob = useCallback(
    (input: { job: CalendarJob; changes: MoveJobChanges; successMessage: string; context?: CalendarRefusalContext | undefined }) => {
      const { job, changes } = input;
      const inverse: MoveJobChanges = {
        ...(changes.plannedDate !== undefined ? { plannedDate: job.plannedDate ?? '' } : {}),
        ...(changes.plannedTime !== undefined ? { plannedTime: job.plannedTime } : {}),
        ...(changes.estimatedDurationMinutes !== undefined ? { estimatedDurationMinutes: job.estimatedDurationMinutes } : {}),
        ...(changes.assignedUserIds !== undefined ? { assignedUserIds: job.assignedUserIds } : {}),
        ...(changes.assignedEmployeeRecordIds !== undefined ? { assignedEmployeeRecordIds: job.assignedEmployeeRecordIds ?? [] } : {}),
        ...(changes.durationDays !== undefined && job.plannedDate ? { durationDays: daysBetween(job.plannedDate, job.endDateExclusive) } : {}),
      };
      return run({
        apply: () => setJob(job.id, (current) => applyChanges(current, changes)),
        revert: () => setJob(job.id, (current) => applyChanges(current, inverse)),
        execute: () => writeJob(job, changes),
        undo: () => writeJob(job, inverse),
        successMessage: input.successMessage,
        context: input.context,
      });
    },
    [run, setJob, writeJob],
  );

  /** Alt-drag: a copy of the visit for another person or day through the create action. */
  const copyJob = useCallback(
    (input: { job: CalendarJob; plannedDate: string; employeeRecordIds: string[]; successMessage: string }) => {
      const { job } = input;
      const sourceDate = job.plannedDate;
      if (!job.occurrenceId || !sourceDate) return Promise.resolve(false);
      const temporaryId = `copy:${job.occurrenceId}:${input.plannedDate}:${input.employeeRecordIds.join(',')}`;
      const copy: CalendarJob = { ...applyChanges(job, { plannedDate: input.plannedDate, assignedEmployeeRecordIds: input.employeeRecordIds, assignedUserIds: [] }), id: temporaryId, occurrenceId: temporaryId, seriesId: null, isException: false };
      const durationMinutes = job.estimatedDurationMinutes ?? null;
      return run({
        apply: () => updateJobs((previous) => [...previous, copy]),
        revert: () => updateJobs((previous) => previous.filter((entry) => entry.id !== temporaryId)),
        execute: () => calendarActionResult(() => createPlanningEntry({
          entryKind: job.entryKind ?? 'job_visit',
          jobId: job.jobId ?? null,
          internalType: job.internalType ?? null,
          title: job.entryKind === 'internal' ? job.title : null,
          description: null,
          location: job.location,
          timeKind: job.plannedTime ? 'timed' : 'all_day',
          startsAtLocal: `${input.plannedDate}T${job.plannedTime ?? '00:00'}`,
          durationMinutes: job.plannedTime ? durationMinutes : null,
          durationDays: job.plannedTime ? null : Math.max(1, daysBetween(sourceDate, job.endDateExclusive)),
          assignmentDrafts: input.employeeRecordIds.map((employeeRecordId) => ({ employeeRecordId, teamSourceId: null })),
          teamIds: [],
          recurrence: null,
          idempotencyKey: crypto.randomUUID(),
          overrideReason: null,
          assessmentFingerprint: null,
        })),
        successMessage: input.successMessage,
      });
    },
    [run, updateJobs],
  );

  /** Time blocks: every source entry moves together, on one person or to another. */
  const moveTimeBlock = useCallback(
    (input: {
      sourceEntries: TimeEntry[];
      updates: Array<{ entryId: string; newUserId: string; newTimestamp: string }>;
      successMessage: string;
      context?: CalendarRefusalContext | undefined;
    }) => {
      const byId = new Map(input.updates.map((update) => [update.entryId, update]));
      const originals = new Map(input.sourceEntries.map((entry) => [entry.id, entry]));
      return run({
        apply: () => updateEntries((previous) => previous.map((entry) => {
          const update = byId.get(entry.id);
          return update ? { ...entry, userId: update.newUserId, timestamp: update.newTimestamp } : entry;
        })),
        revert: () => updateEntries((previous) => previous.map((entry) => originals.get(entry.id) ?? entry)),
        execute: () => calendarActionResult(() => reassignEntryBatchAction(input.updates)),
        undo: () => calendarActionResult(() => reassignEntryBatchAction(input.sourceEntries.map((entry) => ({ entryId: entry.id, newUserId: entry.userId, newTimestamp: entry.timestamp })))),
        successMessage: input.successMessage,
        context: input.context,
      });
    },
    [run, updateEntries],
  );

  /**
   * A resized block: the changed entries write one by one through the entry
   * update (a manager's own entries become change requests there, as before);
   * a failure after a partial success restores the entries already written.
   */
  const resizeTimeBlock = useCallback(
    (input: {
      sourceEntries: TimeEntry[];
      updates: Array<{ entryId: string; newTimestamp: string }>;
      successMessage: string;
      context?: CalendarRefusalContext | undefined;
    }) => {
      const originals = new Map(input.sourceEntries.map((entry) => [entry.id, entry]));
      const writeAll = async (updates: Array<{ entryId: string; newTimestamp: string }>): Promise<ActionResult> => {
        const written: Array<{ entryId: string; original: string }> = [];
        for (const update of updates) {
          if (!isScopeActive()) return { success: false, error: 'calendar_scope_changed' };
          const original = originals.get(update.entryId)?.timestamp;
          const result = await calendarActionResult(() => updateEntryAction(update.entryId, { timestamp: update.newTimestamp }));
          if (result.success) { if (original) written.push({ entryId: update.entryId, original }); continue; }
          for (const previous of written) await updateEntryAction(previous.entryId, { timestamp: previous.original }).catch(() => undefined);
          return result;
        }
        return { success: true };
      };
      return run({
        apply: () => updateEntries((previous) => previous.map((entry) => {
          const update = input.updates.find((candidate) => candidate.entryId === entry.id);
          return update ? { ...entry, timestamp: update.newTimestamp } : entry;
        })),
        revert: () => updateEntries((previous) => previous.map((entry) => originals.get(entry.id) ?? entry)),
        execute: () => writeAll(input.updates),
        undo: () => writeAll(input.updates.flatMap((update) => { const original = originals.get(update.entryId); return original ? [{ entryId: update.entryId, newTimestamp: original.timestamp }] : []; })),
        successMessage: input.successMessage,
        context: input.context,
      });
    },
    [isScopeActive, run, updateEntries],
  );

  /**
   * Park by drag: the card leaves the grid now and the context dialog owns
   * the write. Returns the release for the dialog's outcome: `saved` keeps
   * the placement and offers Undo, `cancelled` and `failed` restore it.
   */
  const beginPark = useCallback((job: CalendarJob) => {
    const jobId = job.jobId ?? job.id;
    const release = beginMutation();
    lastUndoRef.current = null;
    const parkedCard: CalendarJob = { ...job, id: jobId, occurrenceId: undefined, jobId, status: 'geparkt', plannedDate: null, plannedTime: null };
    updateJobs((previous) => previous.filter((entry) => (entry.jobId ?? entry.id) !== jobId));
    updateParkedJobs((previous) => (previous.some((entry) => entry.id === jobId) ? previous : [parkedCard, ...previous]));
    const restore = () => {
      updateParkedJobs((previous) => previous.filter((entry) => entry.id !== jobId));
      updateJobs((previous) => (previous.some((entry) => (entry.jobId ?? entry.id) === jobId) ? previous : [...previous, job]));
    };
    return {
      cancelled: () => { restore(); release(); },
      failed: () => { restore(); release(); silentRefresh(); },
      saved: (undoUnpark: () => Promise<void>) => {
        release();
        announce('Auftrag wurde geparkt.');
        lastUndoRef.current = () => { void undoUnpark(); };
        showBanner({ variant: 'success', message: 'Auftrag wurde geparkt.', actionLabel: 'Rückgängig', onAction: () => { lastUndoRef.current = null; void undoUnpark(); } });
      },
    };
  }, [announce, beginMutation, showBanner, silentRefresh, updateJobs, updateParkedJobs]);

  /** Unpark by drag: one server call; the warning path retries the schedule write with the approval. */
  const unparkJob = useCallback(
    (input: {
      job: CalendarJob;
      parkingContext: JobParkingContext;
      plannedDate: string;
      plannedTime?: string | undefined;
      assignToUserId?: string | undefined;
      durationMinutes?: number | undefined;
      successMessage: string;
      context?: CalendarRefusalContext | undefined;
    }) => {
      const { job, parkingContext } = input;
      const jobId = job.jobId ?? job.id;
      const durationMinutes = input.plannedTime && job.estimatedDurationMinutes == null ? (input.durationMinutes ?? 240) : job.estimatedDurationMinutes;
      const assignedUserIds = input.assignToUserId && !job.assignedUserIds.includes(input.assignToUserId) ? [...job.assignedUserIds, input.assignToUserId] : job.assignedUserIds;
      const placed: CalendarJob = { ...job, plannedDate: input.plannedDate, plannedTime: input.plannedTime ?? null, estimatedDurationMinutes: durationMinutes, assignedUserIds, status: 'nicht_bearbeitet' };
      const schedule = {
        plannedDate: input.plannedDate,
        plannedTime: input.plannedTime ?? '',
        ...(durationMinutes !== job.estimatedDurationMinutes ? { estimatedDurationMinutes: durationMinutes } : {}),
        selectedUserIds: assignedUserIds,
      };
      const restoreContext = parkingContext.responsibleEmployeeRecordId && parkingContext.nextReviewDate
        ? { reason: parkingContext.reason, ...(parkingContext.note !== null ? { details: parkingContext.note } : {}), responsibleEmployeeRecordId: parkingContext.responsibleEmployeeRecordId, nextReviewDate: parkingContext.nextReviewDate }
        : null;
      const execute = async (): Promise<ActionResult> => calendarActionResult(async () => {
        const result = await unparkJobIntoSchedule({
          jobId,
          blockerVersion: parkingContext.version,
          expectedExecutionVersion: job.executionVersion ?? 0,
          reason: 'Im Kalender neu eingeplant',
          schedule,
          restoreContext,
        });
        if (result.success) return result;
        if ((result.error === 'qualification_warning' || result.error === 'stale_evaluation') && 'evaluation' in result) {
          const approval = await requestApproval(result.evaluation);
          if (!approval || !isScopeActive()) {
            if (restoreContext) await parkWorkTarget({ targetType: 'job', targetId: jobId, expectedExecutionVersion: job.executionVersion ?? 0, ...restoreContext });
            return { success: false as const, error: 'qualification_declined' };
          }
          return updateJobAction(jobId, { ...schedule, assignmentApproval: approval });
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
          updateParkedJobs((previous) => (previous.some((entry) => entry.id === jobId) ? previous : [job, ...previous]));
        },
        execute,
        undo: restoreContext
          ? () => calendarActionResult(() => parkWorkTarget({ targetType: 'job', targetId: jobId, expectedExecutionVersion: (jobsRef.current.find((entry) => entry.id === jobId)?.executionVersion ?? job.executionVersion ?? 0), ...restoreContext }))
          : undefined,
        successMessage: input.successMessage,
        context: input.context,
      });
    },
    [isScopeActive, jobsRef, requestApproval, run, updateJobs, updateParkedJobs],
  );

  return useMemo(() => ({ run, moveJob, copyJob, moveTimeBlock, resizeTimeBlock, beginPark, unparkJob, undoLast, writeJob }), [run, moveJob, copyJob, moveTimeBlock, resizeTimeBlock, beginPark, unparkJob, undoLast, writeJob]);
}

export type CalendarMutations = ReturnType<typeof useCalendarMutations>;

function daysBetween(startDate: string, endDateExclusive: string | null | undefined): number {
  if (!endDateExclusive) return 1;
  return Math.round((Date.parse(`${endDateExclusive}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000);
}
