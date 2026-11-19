// What reaches the owner: the Aufgaben tasks that need Admin's decision, and
// the thresholds that decide when. Pure; the owner start renders what this
// selects, and the attention derivation hands Admin the overdue callbacks it
// escalates. Unit-tested in owner-exceptions.test.ts.

import { countWorkdaysAfter, formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { OrgRole } from '@/lib/roles';
import { groupAttentionTasks, type AttentionTaskSection } from './task-sections';
import type { AttentionTask } from './types';

/** The thresholds of the owner start, in Monday-to-Friday days. */
export const OWNER_EXCEPTION_THRESHOLDS = {
  /** An overdue callback reaches Admin once it is overdue more than this many workdays. */
  callbackOverdueWorkdays: 2,
  /** An Übergabe reaches Admin once it waited more than this many workdays after the execution completed. */
  handoverWaitingWorkdays: 2,
} as const;

function isPastThreshold(sinceDate: string, businessDate: string, workdays: number): boolean {
  return countWorkdaysAfter(sinceDate, businessDate) > workdays;
}

function isCallbackPastThreshold(callbackDueAt: string, businessDate: string): boolean {
  return isPastThreshold(
    formatBerlinLocalDate(callbackDueAt),
    businessDate,
    OWNER_EXCEPTION_THRESHOLDS.callbackOverdueWorkdays,
  );
}

/**
 * Whether Admin sees another manager's overdue callback as their own task: once
 * it is overdue past the threshold, counted by the Berlin day of its deadline.
 */
export function escalatesCallbackToAdmin(
  viewerRole: OrgRole,
  callbackDueAt: string,
  businessDate: string,
): boolean {
  return viewerRole === 'admin' && isCallbackPastThreshold(callbackDueAt, businessDate);
}

/** Whether a task of Admin's Aufgaben is an exception for the owner start on a Berlin business date. */
function isOwnerException(task: AttentionTask, businessDate: string): boolean {
  switch (task.sourceType) {
    // Corrections and vacation wait for Admin as their responsible approver.
    case 'time_change_request_approval':
    case 'time_correction_approval':
    case 'vacation_request_approval':
    case 'dispatch_challenge_open':
      return true;
    case 'client_request_callback_overdue':
      return isCallbackPastThreshold(task.callbackDueAt, businessDate);
    case 'work_handover_review':
      return isPastThreshold(
        task.completedOn,
        businessDate,
        OWNER_EXCEPTION_THRESHOLDS.handoverWaitingWorkdays,
      );
    case 'work_blocker_review':
      return task.nextReviewDate < businessDate;
    case 'time_session_approval':
    case 'client_request_open':
    case 'client_follow_up':
    case 'dispatch_acknowledgement':
    case 'work_artifact_review':
    case 'work_artifact_correction':
    case 'work_defect_due':
    case 'organization_join_request':
    case 'planning_visit_replan':
    case 'site_access_proposal':
    case 'job_past_last_visit':
      return false;
  }
}

/** The owner's exceptions in the order of the Aufgaben sections; each section keeps the order of its tasks. */
export function groupOwnerExceptions(
  tasks: readonly AttentionTask[],
  businessDate: string,
): AttentionTaskSection[] {
  return groupAttentionTasks(tasks.filter((task) => isOwnerException(task, businessDate)));
}
