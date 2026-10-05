'use client';

import { useCallback, useRef } from 'react';
import { calendarActionResult } from '@/lib/calendar/action-result';
import type { CalendarRefusalContext } from '@/lib/calendar/messages';
import {
  applyChanges,
  daysBetween,
  inverseChanges,
  jobInputFrom,
  planningInputFrom,
  type MoveJobChanges,
} from '@/lib/calendar/job-changes';
import { copiedVisit } from '@/lib/calendar/visit-placement';
import type { CalendarJob } from '@/lib/jobs/types';
import { updateJob as updateJobAction } from '@/lib/jobs/actions';
import { createPlanningEntry, updatePlanningCalendarEntry } from '@/lib/planning/actions';
import type { ActionResult, OptimisticOperation } from './use-optimistic-run';
import type { UseCalendarMutationsOptions } from './use-calendar-mutations';

type PendingJobMoves = { confirmed: CalendarJob; latest: number; tail: Promise<ActionResult | null> };

/**
 * Visit writes: the job or planning write with the qualification and planning
 * dialogs, ordered moves per visit (every gesture applies at once, writes run
 * in gesture order, Undo joins the same queue), and the Alt-drag copy.
 */
export function useCalendarVisitWrites({
  updateJobs,
  requestApproval,
  requestPlanningApproval,
  isScopeActive,
  run,
}: Pick<UseCalendarMutationsOptions, 'updateJobs' | 'requestApproval' | 'requestPlanningApproval'> & {
  isScopeActive: () => boolean;
  run: (operation: OptimisticOperation) => Promise<boolean>;
}) {
  const pendingJobMovesRef = useRef(new Map<string, PendingJobMoves>());

  /** The existing job write with the qualification and planning dialogs (unchanged rules). */
  const writeJob = useCallback(
    async (job: CalendarJob, changes: MoveJobChanges): Promise<ActionResult> =>
      calendarActionResult(async () => {
        if (!isScopeActive()) return { success: false as const, error: 'calendar_scope_changed' };
        if (job.occurrenceId) {
          const planningInput = planningInputFrom(changes);
          let result = await updatePlanningCalendarEntry(job.occurrenceId, planningInput);
          if (
            !result.success &&
            (result.error === 'planning_warning' || result.error === 'stale_assessment') &&
            result.conflicts &&
            result.fingerprint
          ) {
            const approval = await requestPlanningApproval(result.conflicts, result.fingerprint);
            if (!approval || !isScopeActive())
              return { success: false as const, error: 'qualification_declined' };
            result = await updatePlanningCalendarEntry(job.occurrenceId, {
              ...planningInput,
              overrideReason: approval.reason,
              assessmentFingerprint: approval.fingerprint,
            });
          }
          return result;
        }
        const input = jobInputFrom(changes);
        let result = await updateJobAction(job.id, input);
        if (
          !result.success &&
          (result.error === 'qualification_warning' || result.error === 'stale_evaluation') &&
          'evaluation' in result
        ) {
          const approval = await requestApproval(result.evaluation);
          if (!approval || !isScopeActive())
            return { success: false as const, error: 'qualification_declined' };
          result = await updateJobAction(job.id, { ...input, assignmentApproval: approval });
        }
        return result;
      }),
    [isScopeActive, requestApproval, requestPlanningApproval],
  );

  const setJob = useCallback(
    (jobId: string, next: (job: CalendarJob) => CalendarJob) => {
      updateJobs((previous) => previous.map((job) => (job.id === jobId ? next(job) : job)));
    },
    [updateJobs],
  );

  /** Move, resize or reassign one visit; the inverse restores every changed field. */
  const moveJob = useCallback(
    (input: {
      job: CalendarJob;
      changes: MoveJobChanges;
      successMessage: string;
      context?: CalendarRefusalContext | undefined;
    }) => {
      const { job, changes } = input;
      const pending: PendingJobMoves = pendingJobMovesRef.current.get(job.id) ?? {
        confirmed: job,
        latest: 0,
        tail: Promise.resolve(null),
      };
      pendingJobMovesRef.current.set(job.id, pending);
      const revision = ++pending.latest;
      let inverse: MoveJobChanges = {};
      let saved = false;
      // Apply every gesture immediately, but write one occurrence in gesture order.
      // Undo is based on the last successful write, not an unconfirmed earlier gesture.
      const execution = pending.tail.then(async (previous) => {
        // Later gestures were made against the optimistic result of this write.
        // After failure, none may commit only its own fields against older state.
        if (previous && !previous.success) return previous;
        const confirmed = pending.confirmed;
        inverse = inverseChanges(confirmed, changes);
        const result = await writeJob(confirmed, changes);
        saved = result.success;
        if (saved) {
          pending.confirmed = applyChanges(confirmed, changes);
          if (pending.latest === revision && isScopeActive()) setJob(job.id, () => pending.confirmed);
        }
        return result;
      });
      pending.tail = execution;
      return run({
        apply: () => setJob(job.id, (current) => applyChanges(current, changes)),
        revert: () => {
          if (pending.latest !== revision) return;
          setJob(job.id, (current) => (saved ? applyChanges(current, inverse) : pending.confirmed));
        },
        execute: () => execution,
        undo: () => {
          // A new gesture during Undo must start from the last confirmed position.
          const undoRevision = ++pending.latest;
          pendingJobMovesRef.current.set(job.id, pending);
          const undoExecution = pending.tail.then(async () => {
            const result = await writeJob(pending.confirmed, inverse);
            if (result.success) pending.confirmed = applyChanges(pending.confirmed, inverse);
            if (pending.latest === undoRevision && isScopeActive()) setJob(job.id, () => pending.confirmed);
            return result;
          });
          pending.tail = undoExecution;
          return undoExecution.finally(() => {
            if (pending.latest === undoRevision) pendingJobMovesRef.current.delete(job.id);
          });
        },
        successMessage: input.successMessage,
        context: input.context,
      }).finally(() => {
        if (pending.latest === revision) pendingJobMovesRef.current.delete(job.id);
      });
    },
    [isScopeActive, run, setJob, writeJob],
  );

  /** Alt-drag: a copy of the visit for another person or day through the create action. */
  const copyJob = useCallback(
    (input: {
      job: CalendarJob;
      plannedDate: string;
      employeeRecordIds: string[];
      successMessage: string;
    }) => {
      const { job } = input;
      const sourceDate = job.plannedDate;
      if (!job.occurrenceId || !sourceDate) return Promise.resolve(false);
      const copy = copiedVisit({
        job,
        occurrenceId: job.occurrenceId,
        plannedDate: input.plannedDate,
        employeeRecordIds: input.employeeRecordIds,
      });
      const temporaryId = copy.id;
      const durationMinutes = job.estimatedDurationMinutes ?? null;
      return run({
        apply: () => updateJobs((previous) => [...previous, copy]),
        revert: () => updateJobs((previous) => previous.filter((entry) => entry.id !== temporaryId)),
        execute: () =>
          calendarActionResult(() =>
            createPlanningEntry({
              entryKind: job.entryKind ?? 'job_visit',
              jobId: job.jobId ?? null,
              internalType: job.internalType ?? null,
              title: job.entryKind === 'internal' ? job.title : null,
              description: null,
              location: job.location,
              timeKind: job.plannedTime ? 'timed' : 'all_day',
              startsAtLocal: `${input.plannedDate}T${job.plannedTime ?? '00:00'}`,
              durationMinutes: job.plannedTime ? durationMinutes : null,
              durationDays: job.plannedTime
                ? null
                : Math.max(1, daysBetween(sourceDate, job.endDateExclusive)),
              assignmentDrafts: input.employeeRecordIds.map((employeeRecordId) => ({
                employeeRecordId,
                teamSourceId: null,
              })),
              teamIds: [],
              recurrence: null,
              idempotencyKey: crypto.randomUUID(),
              overrideReason: null,
              assessmentFingerprint: null,
            }),
          ),
        successMessage: input.successMessage,
      });
    },
    [run, updateJobs],
  );

  return { writeJob, moveJob, copyJob };
}
