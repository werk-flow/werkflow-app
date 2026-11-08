import 'server-only';

// The planner's „Einsatz umplanen“ tasks behind the attention Server Actions
// in `./actions`: an approved vacation that takes a person away from a
// scheduled visit. Derived live from the vacation requests and the planning
// reader the approval card uses; never stored.

import { loadAbsencesAffectedVisits } from '@/lib/calendar/absence-visits';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging';
import { readOpenVacationRequests } from '@/lib/vacation/server';
import { readPersonNames } from './notifications';
import { dedupeAttentionItems } from './resolution';
import type { AttentionTask } from './types';

/**
 * One task per visit and person an approved vacation still ahead takes away,
 * in the calendar's order. Planning is office work, so only Admin and Büro
 * get it, as the affected-visits reader they share. A visit already past
 * needs no replanning, so each vacation counts from today.
 */
export async function deriveVisitReplanTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const admin = createSupabaseAdminClient();
  const today = getBusinessTodayIso();
  // The approver queue's read of the open requests, shared within one request.
  const openRequests = await readOpenVacationRequests(context.orgId, today);
  if (openRequests.error) {
    logError('Failed to load approved vacations for replanning', openRequests.error);
    return { tasks: [], failed: true };
  }
  const vacations = openRequests.data.filter((row) => row.status === 'approved');
  const affected = await loadAbsencesAffectedVisits({
    admin,
    orgId: context.orgId,
    absences: vacations.map((vacation) => ({
      employeeRecordId: vacation.employee_record_id,
      from: vacation.start_date > today ? vacation.start_date : today,
      to: vacation.end_date,
    })),
  });
  if (!affected) return { tasks: [], failed: true };
  const affectedVacations = vacations.flatMap((vacation, index) =>
    (affected[index] ?? []).map((entry) => ({ employee_record_id: vacation.employee_record_id, ...entry })),
  );
  const nameByRecordId = await readPersonNames(admin, context.orgId, affectedVacations);
  if (!nameByRecordId) return { tasks: [], failed: true };
  // A visit two vacations of one person both reach is still one task.
  const tasks = affectedVacations
    .toSorted((left, right) =>
      `${left.visit.date} ${left.visit.time ?? ''}`.localeCompare(
        `${right.visit.date} ${right.visit.time ?? ''}`,
      ),
    )
    .map(
      ({ employee_record_id, assignmentId, visit }): AttentionTask => ({
        sourceType: 'planning_visit_replan',
        sourceId: assignmentId,
        personName: nameByRecordId.get(employee_record_id) ?? 'Unbekannt',
        date: visit.date,
        time: visit.time,
        visitTitle: visit.title,
        jobNumber: visit.jobNumber,
        dispatchState: visit.dispatchState,
      }),
    );
  return { tasks: dedupeAttentionItems(tasks), failed: false };
}
