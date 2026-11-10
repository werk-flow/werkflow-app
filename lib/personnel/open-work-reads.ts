import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { formatBerlinLocalDateTime, getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { z } from '@/lib/zod';
import { OPEN_JOB_STATUSES, orderOpenWork, type OpenWorkJob, type OpenWorkVisit } from './open-work';

// The read behind a person's open work (./open-work). An internal server
// helper: its callers authorize and pass the admin client.

// The admin client is untyped for embedded relations, so they are parsed where they cross in.
const openJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  job_number: z.string().nullable(),
  status: z.enum(OPEN_JOB_STATUSES),
});
const teamRowSchema = z.object({ jobs: openJobSchema });
const visitRowSchema = z.object({
  id: z.string(),
  start_at: z.string().nullable(),
  start_date: z.string().nullable(),
  job: openJobSchema,
});

type OpenJob = z.infer<typeof openJobSchema>;

function labelOf(job: OpenJob): string {
  return job.job_number ? `${job.job_number} · ${job.title}` : job.title;
}

function toVisit(row: z.infer<typeof visitRowSchema>): OpenWorkVisit | null {
  const startLocal = row.start_at ? formatBerlinLocalDateTime(row.start_at) : null;
  const date = startLocal?.slice(0, 10) ?? row.start_date;
  if (!date) return null;
  return { occurrenceId: row.id, date, time: startLocal?.slice(11, 16) ?? null };
}

/**
 * The open jobs a person holds: on the team (with a login) or on a scheduled
 * visit that has not started, each with those visits. Null when a read fails
 * or overflows: missing work is never „nothing open“.
 */
export async function readOpenWork(
  admin: AdminClient,
  organizationId: string,
  person: { employeeRecordId: string; userId: string | null },
): Promise<OpenWorkJob[] | null> {
  const { userId } = person;
  const now = new Date().toISOString();
  const today = getBusinessTodayIso();
  const [teamRows, visitRows] = await Promise.all([
    userId
      ? readCompleteRows(
          (from, to) =>
            admin
              .from('job_assignments')
              .select('jobs!inner(id, title, job_number, status)')
              .eq('organization_id', organizationId)
              .eq('user_id', userId)
              .in('jobs.status', [...OPEN_JOB_STATUSES])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        )
      : Promise.resolve({ data: [], error: null }),
    readCompleteRows(
      (from, to) =>
        admin
          .from('planning_occurrences')
          .select(
            'id, start_at, start_date, job:jobs!planning_occurrences_job_id_fkey!inner(id, title, job_number, status), mine:planning_occurrence_assignments!inner(employee_record_id)',
          )
          .eq('organization_id', organizationId)
          .eq('status', 'scheduled')
          .eq('mine.employee_record_id', person.employeeRecordId)
          .in('job.status', [...OPEN_JOB_STATUSES])
          .or(`start_at.gt.${now},start_date.gt.${today}`)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (teamRows.error || visitRows.error) {
    logReadFailure('readOpenWork: open work failed', {
      code: teamRows.error?.code ?? visitRows.error?.code ?? 'unknown',
    });
    return null;
  }
  const team = z.array(teamRowSchema).safeParse(teamRows.data);
  const visits = z.array(visitRowSchema).safeParse(visitRows.data);
  if (!team.success || !visits.success) {
    logReadFailure('readOpenWork: open work failed', { code: 'unexpected_shape' });
    return null;
  }

  const jobs = new Map<string, OpenWorkJob>();
  const jobOf = (job: OpenJob): OpenWorkJob => {
    const known = jobs.get(job.id);
    if (known) return known;
    const created = { jobId: job.id, label: labelOf(job), parked: job.status === 'geparkt', visits: [] };
    jobs.set(job.id, created);
    return created;
  };
  for (const row of team.data) jobOf(row.jobs);
  for (const row of visits.data) {
    const visit = toVisit(row);
    if (visit) jobOf(row.job).visits.push(visit);
  }
  return orderOpenWork([...jobs.values()]);
}
