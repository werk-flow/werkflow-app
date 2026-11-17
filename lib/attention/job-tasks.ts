// The office's overdue job tasks behind the attention Server Actions in
// `./actions`: open jobs whose visits are over. The database returns the
// candidates with the office's other pending sets (`./manager-sets`); the
// Berlin-day rule is here.

import { addLocalDays, formatBerlinLocalDate, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { jobDetailHref } from '@/lib/jobs/routes';
import type { ActionContext } from '@/lib/org/action-context';
import { LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { ManagerAttentionSetsRead } from './manager-sets';
import type { AttentionTask } from './types';

// An open job whose every scheduled visit has ended; at least one end is set.
const overdueJobRowSchema = z.object({
  id: uuidSchema,
  job_number: z.string().nullable(),
  title: z.string(),
  project_id: uuidSchema.nullable(),
  project_number: z.string().nullable(),
  last_timed_end: z.string().nullable(),
  last_all_day_end: z.string().nullable(),
});

/** The job set of read_manager_attention_sets; it holds at most LIST_ROW_CAP + 1 rows, one more is an overflow. */
export const overdueJobSetSchema = z.object({
  overdue_jobs: z.array(overdueJobRowSchema).max(LIST_ROW_CAP),
});

export type OverdueJobRow = z.infer<typeof overdueJobRowSchema>;

/**
 * The Berlin day the job's scheduled visits end on: the later of the last
 * timed visit's end day and the last all-day visit's last day. A timed visit
 * that ends exactly at midnight ends on the day before.
 */
function lastVisitDate(row: Pick<OverdueJobRow, 'last_timed_end' | 'last_all_day_end'>): string | null {
  const timed = row.last_timed_end
    ? formatBerlinLocalDate(new Date(Date.parse(row.last_timed_end) - 1))
    : null;
  const allDay = row.last_all_day_end ? addLocalDays(row.last_all_day_end, -1) : null;
  if (timed === null || allDay === null) return timed ?? allDay;
  return timed > allDay ? timed : allDay;
}

/**
 * The jobs whose last visit lies before `today` (Berlin), the longest overdue
 * first. A visit that ended earlier today leaves its job alone until tomorrow.
 */
export function toOverdueJobTasks(overdueJobs: readonly OverdueJobRow[], today: string): AttentionTask[] {
  return overdueJobs
    .flatMap((row) => {
      const date = lastVisitDate(row);
      return date !== null && date < today ? [{ row, date }] : [];
    })
    .toSorted((left, right) => left.date.localeCompare(right.date))
    .map(
      ({ row, date }): AttentionTask => ({
        sourceType: 'job_past_last_visit',
        sourceId: row.id,
        jobLabel: row.job_number ? `${row.job_number} · ${row.title}` : row.title,
        jobHref: jobDetailHref(
          { id: row.id, jobNumber: row.job_number },
          row.project_id ? { id: row.project_id, projectNumber: row.project_number } : null,
        ),
        lastVisitDate: date,
      }),
    );
}

/** Replanning or closing the work is office work, so only Admin and Büro get these tasks. */
export async function deriveOverdueJobTasks(
  context: ActionContext,
  managerSets: ManagerAttentionSetsRead,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') return { tasks: [], failed: false };
  const sets = await managerSets;
  if (sets.failed) return { tasks: [], failed: true };
  return { tasks: toOverdueJobTasks(sets.overdueJobs, getBusinessTodayIso()), failed: false };
}
