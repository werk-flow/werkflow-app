import 'server-only';

// The planner's „Einsatz umplanen“ tasks behind the attention Server Actions
// in `./actions`: an approved vacation that takes a person away from a
// scheduled visit, or a visit after the person's exit, which the handover
// left open. Derived live from the open absences the approver queue reads in
// the same request and the planning reader the approval card uses; never
// stored.

import { loadAbsencesAffectedVisits, type AbsenceVisitWindow } from '@/lib/calendar/absence-visits';
import { getBusinessTodayIso, resolveBerlinWallTime } from '@/lib/date-time/berlin';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { logError } from '@/lib/logging';
import { readOpenAbsences } from '@/lib/vacation/server';
import { readPersonNames } from './notifications';
import { dedupeAttentionItems } from './resolution';
import type { AttentionTask } from './types';
import type { AbsenceAffectedVisit } from '@/lib/calendar/absence-visits-types';

/**
 * Whether the visit has started, the rule that makes it history the planning
 * actions refuse to change: a timed visit at its start, an all-day one on its day.
 */
function hasStarted(visit: AbsenceAffectedVisit, now: number, today: string): boolean {
  if (visit.time === null) return visit.date <= today;
  const start = resolveBerlinWallTime(`${visit.date}T${visit.time}`);
  return !start || start.instant.getTime() <= now;
}

/** A leaver's window has no end: every later visit is one the person can no longer do. */
const LEAVER_WINDOW_END = '9999-12-30';

/**
 * One task per visit and person an approved vacation still ahead or an exit
 * takes away, in the calendar's order. Planning is office work, so only Admin and Büro
 * get it, as the affected-visits reader they share. A visit that started
 * needs no replanning, so each vacation counts from today.
 */
export async function deriveVisitReplanTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const admin = createSupabaseAdminClient();
  const today = getBusinessTodayIso();
  // The approver queue's read of the open absences, shared within one request.
  const openAbsences = await readOpenAbsences(context.orgId, today);
  if (openAbsences.error) {
    logError('Failed to load open absences for replanning', openAbsences.error);
    return { tasks: [], failed: true };
  }
  const vacations = openAbsences.data.vacations.filter((row) => row.status === 'approved');
  const absences: AbsenceVisitWindow[] = [
    ...vacations.map((vacation) => ({
      employeeRecordId: vacation.employee_record_id,
      from: vacation.start_date > today ? vacation.start_date : today,
      to: vacation.end_date,
    })),
    ...openAbsences.data.leaverWindows.map((window) => ({ ...window, to: LEAVER_WINDOW_END })),
  ];
  const affected = await loadAbsencesAffectedVisits({ admin, orgId: context.orgId, absences });
  if (!affected) return { tasks: [], failed: true };
  // A started visit can no longer be replanned, so it is no task.
  const now = Date.now();
  const affectedVacations = absences.flatMap((absence, index) =>
    (affected[index] ?? []).flatMap((entry) =>
      hasStarted(entry.visit, now, today) ? [] : [{ employee_record_id: absence.employeeRecordId, ...entry }],
    ),
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
