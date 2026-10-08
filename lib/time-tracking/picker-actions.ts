'use server';

import type { ActionFailure } from '@/lib/action-result';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getLocalDayEnd, getLocalDayStart } from './day-utils';

type PickerJob = {
  id: string;
  title: string;
  jobNumber: string | null;
  status: string;
  projectName: string | null;
  clientName: string | null;
  /** The caller is assigned to a scheduled visit of this job on today's Berlin date. */
  plannedToday: boolean;
};

/**
 * Job IDs with a scheduled P1-11 visit on today's Berlin date that assigns the
 * caller's own employee record. Read-only planning context for the picker
 * order; a failure yields no highlight rather than a failed picker.
 */
async function getJobIdsPlannedTodayForUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  userId: string,
): Promise<Set<string>> {
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (recordError) logReadFailure('getJobIdsPlannedTodayForUser: employee record failed', recordError);
  if (!record) return new Set();
  const now = new Date();
  const today = getBusinessTodayIso();
  const { data, error } = await admin
    .from('planning_occurrences')
    .select('job_id, own:planning_occurrence_assignments!inner(employee_record_id)')
    .eq('organization_id', organizationId)
    .eq('entry_kind', 'job_visit')
    .eq('status', 'scheduled')
    .eq('own.employee_record_id', record.id)
    .or(
      `and(time_kind.eq.timed,start_at.lt.${getLocalDayEnd(now).toISOString()},end_at.gt.${getLocalDayStart(now).toISOString()}),` +
        `and(time_kind.eq.all_day,start_date.lte.${today},end_date_exclusive.gt.${today})`,
    );
  if (error) {
    logError('Error fetching planned jobs for the picker:', error);
    return new Set();
  }
  return new Set((data ?? []).flatMap((row) => (row.job_id ? [row.job_id] : [])));
}

/**
 * Get jobs for the clock-in / job-switch picker.
 * Admin/manager: all non-archived org jobs.
 * Employee: only assigned, non-archived jobs.
 */
export async function getJobsForPicker(
  rawOrganizationId: string,
): Promise<{ success: true; jobs: PickerJob[] } | ActionFailure> {
  try {
    const parsed = uuidSchema.safeParse(rawOrganizationId);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const organizationId = parsed.data;
    const auth = await resolveActionContextFor(organizationId);
    if (!auth.success) return auth;
    const { userId, isManagerOrAbove } = auth.context;

    const admin = createSupabaseAdminClient();

    let jobIds: string[] | null = null;

    if (!isManagerOrAbove) {
      const { data: assignments, error: assignError } = await readCompleteRows(
        (from, to) =>
          admin
            .from('job_assignments')
            .select('job_id')
            .eq('organization_id', organizationId)
            .eq('user_id', userId)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      );

      if (assignError) {
        logError('Error fetching job assignments:', assignError);
        return { success: false, error: 'fetch_failed' };
      }

      if (assignments.length === 0) {
        return { success: true, jobs: [] };
      }

      jobIds = assignments.map((a) => a.job_id);
    }

    const jobQuery = () =>
      admin
        .from('jobs')
        .select('id, title, description, job_number, status, project_id, client_id')
        .eq('organization_id', organizationId)
        .neq('status', 'fertig')
        .order('title', { ascending: true })
        .order('id');
    const { data: jobs, error: jobsError } = jobIds
      ? await readInBatches(jobIds, (batch) =>
          readCompleteRows(
            (from, to) =>
              jobQuery()
                .in('id', [...batch])
                .range(from, to),
            LIST_ROW_CAP,
          ),
        )
      : await readCompleteRows((from, to) => jobQuery().range(from, to), LIST_ROW_CAP);

    if (jobsError) {
      logReadFailure('Error fetching picker jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }
    // Batches arrive in id order; restore the title order of the single query.
    if (jobIds)
      jobs.sort(
        (left, right) => left.title.localeCompare(right.title, 'de') || left.id.localeCompare(right.id),
      );

    const projectIds = jobs.map((j) => j.project_id).filter((id): id is string => id !== null);
    const clientIds = jobs.map((j) => j.client_id).filter((id): id is string => id !== null);

    const [projectsData, clientsData, plannedToday] = await Promise.all([
      readInBatches(projectIds, (batch) =>
        admin
          .from('projects')
          .select('id, name')
          .eq('organization_id', organizationId)
          .in('id', [...batch]),
      ),
      readInBatches(clientIds, (batch) =>
        admin
          .from('clients')
          .select('id, name')
          .eq('organization_id', organizationId)
          .in('id', [...batch]),
      ),
      getJobIdsPlannedTodayForUser(admin, organizationId, userId),
    ]);
    const labelError = projectsData.error ?? clientsData.error;
    if (labelError) logReadFailure('getJobsForPicker: project or customer names failed', labelError);

    const projectMap: Record<string, string> = Object.fromEntries(
      projectsData.data.map((p) => [p.id, p.name]),
    );
    const clientMap: Record<string, string> = Object.fromEntries(clientsData.data.map((c) => [c.id, c.name]));

    return {
      success: true,
      jobs: jobs.map((j) => ({
        id: j.id,
        title: getJobDisplayTitle({
          title: j.title,
          description: j.description,
        }),
        jobNumber: j.job_number,
        status: j.status,
        projectName: j.project_id ? (projectMap[j.project_id] ?? null) : null,
        clientName: j.client_id ? (clientMap[j.client_id] ?? null) : null,
        plannedToday: plannedToday.has(j.id),
      })),
    };
  } catch (error) {
    logError('Unexpected error in getJobsForPicker:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
