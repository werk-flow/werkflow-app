'use server';

import { getAuthenticatedUser, getCachedMemberships } from '@/lib/data/cached';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
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
  userId: string
): Promise<Set<string>> {
  const { data: record } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
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
        `and(time_kind.eq.all_day,start_date.lte.${today},end_date_exclusive.gt.${today})`
    );
  if (error) {
    console.error('Error fetching planned jobs for the picker:', error);
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
  organizationId: string
): Promise<
  { success: true; jobs: PickerJob[] } | { success: false; error: string }
> {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return { success: false, error: 'not_authenticated' };
    }

    const memberships = await getCachedMemberships(user.id);
    const role = memberships.find((membership) => membership.orgId === organizationId)?.role ?? null;
    if (!role) {
      return { success: false, error: 'not_a_member' };
    }

    const admin = createSupabaseAdminClient();
    const isManagerOrAbove = role === 'admin' || role === 'buero';

    let jobIds: string[] | null = null;

    if (!isManagerOrAbove) {
      const { data: assignments, error: assignError } = await admin
        .from('job_assignments')
        .select('job_id')
        .eq('user_id', user.id);

      if (assignError) {
        console.error('Error fetching job assignments:', assignError);
        return { success: false, error: 'fetch_failed' };
      }

      if (!assignments || assignments.length === 0) {
        return { success: true, jobs: [] };
      }

      jobIds = assignments.map((a) => a.job_id);
    }

    let query = admin
      .from('jobs')
      .select('id, title, description, job_number, status, project_id, client_id')
      .eq('organization_id', organizationId)
      .neq('status', 'fertig')
      .order('title', { ascending: true });

    if (jobIds) {
      query = query.in('id', jobIds);
    }

    const { data: jobs, error: jobsError } = await query;

    if (jobsError) {
      console.error('Error fetching picker jobs:', jobsError);
      return { success: false, error: 'fetch_failed' };
    }

    const projectIds = (jobs || [])
      .map((j) => j.project_id)
      .filter((id): id is string => id !== null);
    const clientIds = (jobs || [])
      .map((j) => j.client_id)
      .filter((id): id is string => id !== null);

    let projectMap: Record<string, string> = {};
    let clientMap: Record<string, string> = {};

    const [projectsData, clientsData, plannedToday] = await Promise.all([
      projectIds.length > 0
        ? admin
            .from('projects')
            .select('id, name')
            .in('id', [...new Set(projectIds)])
        : null,
      clientIds.length > 0
        ? admin
            .from('clients')
            .select('id, name')
            .in('id', [...new Set(clientIds)])
        : null,
      getJobIdsPlannedTodayForUser(admin, organizationId, user.id),
    ]);

    if (projectsData?.data) {
      projectMap = Object.fromEntries(
        projectsData.data.map((p) => [p.id, p.name])
      );
    }
    if (clientsData?.data) {
      clientMap = Object.fromEntries(
        clientsData.data.map((c) => [c.id, c.name])
      );
    }

    return {
      success: true,
      jobs: (jobs || []).map((j) => ({
        id: j.id,
        title: getJobDisplayTitle({
          title: j.title,
          description: j.description
        }),
        jobNumber: j.job_number,
        status: j.status,
        projectName: j.project_id ? (projectMap[j.project_id] ?? null) : null,
        clientName: j.client_id ? (clientMap[j.client_id] ?? null) : null,
        plannedToday: plannedToday.has(j.id),
      }))
    };
  } catch (error) {
    console.error('Unexpected error in getJobsForPicker:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

