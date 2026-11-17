// The office's job planning tasks behind the attention Server Actions in
// `./actions`: open jobs nobody will do until the office plans them, and open
// jobs whose visits are over. The database returns the candidates with the
// office's other pending sets (`./manager-sets`); the Berlin-day rule is here.

import { addLocalDays, formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { jobDetailHref } from '@/lib/jobs/routes';
import type { ActionContext } from '@/lib/org/action-context';
import type { ManagerAttentionSetsRead, OverdueJobRow, UnplannedJobRow } from './manager-sets';
import type { AttentionTask } from './types';

/**
 * The Berlin day the job's scheduled visits end on: the later of the last
 * timed visit's end day and the last all-day visit's last day. A timed visit
 * that ends exactly at midnight ends on the day before.
 */
export function lastVisitDate(
  row: Pick<OverdueJobRow, 'last_timed_end' | 'last_all_day_end'>,
): string | null {
  const timed = row.last_timed_end
    ? formatBerlinLocalDate(new Date(Date.parse(row.last_timed_end) - 1))
    : null;
  const allDay = row.last_all_day_end ? addLocalDays(row.last_all_day_end, -1) : null;
  if (timed === null || allDay === null) return timed ?? allDay;
  return timed > allDay ? timed : allDay;
}

function jobLink(row: UnplannedJobRow): { jobLabel: string; jobHref: string } {
  return {
    jobLabel: row.job_number ? `${row.job_number} · ${row.title}` : row.title,
    jobHref: jobDetailHref(
      { id: row.id, jobNumber: row.job_number },
      row.project_id ? { id: row.project_id, projectNumber: row.project_number } : null,
    ),
  };
}

/**
 * The unplanned jobs in the database's oldest-first order, and the jobs whose
 * last visit lies before `today` (Berlin), the longest overdue first. A visit
 * that ended earlier today leaves its job alone until tomorrow.
 */
export function toJobPlanningTasks(
  sets: { unplannedJobs: readonly UnplannedJobRow[]; overdueJobs: readonly OverdueJobRow[] },
  today: string,
): AttentionTask[] {
  const pastLastVisit = sets.overdueJobs
    .flatMap((row) => {
      const date = lastVisitDate(row);
      return date !== null && date < today ? [{ row, date }] : [];
    })
    .toSorted((left, right) => left.date.localeCompare(right.date))
    .map(
      ({ row, date }): AttentionTask => ({
        sourceType: 'job_past_last_visit',
        sourceId: row.id,
        ...jobLink(row),
        lastVisitDate: date,
      }),
    );
  const unplanned = sets.unplannedJobs.map(
    (row): AttentionTask => ({
      sourceType: 'job_unplanned',
      sourceId: row.id,
      ...jobLink(row),
      createdDate: formatBerlinLocalDate(row.created_at),
    }),
  );
  return [...pastLastVisit, ...unplanned];
}

/** Planning is office work, so only Admin and Büro get these tasks. */
export async function deriveJobPlanningTasks(
  context: ActionContext,
  managerSets: ManagerAttentionSetsRead,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const sets = await managerSets;
  if (sets.failed) return { tasks: [], failed: true };
  return { tasks: toJobPlanningTasks(sets, getBusinessTodayIso()), failed: false };
}
