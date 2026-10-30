import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { getJobDisplayTitle, normalizeJobPlannedTime, type CalendarJob, type JobRow } from './types';

// The reader behind getParkedJobs in ./actions. The caller passes the context
// authenticateAndAuthorize resolved.

const PARKED_JOB_COLUMNS =
  'id, title, description, job_number, status, priority, planned_date, planned_time, estimated_duration_minutes, planned_working_minutes, location, client_id, project_id, updated_at, execution_version, execution_state';

type ParkedJobRow = Pick<
  JobRow,
  | 'id'
  | 'title'
  | 'description'
  | 'job_number'
  | 'status'
  | 'priority'
  | 'planned_date'
  | 'planned_time'
  | 'estimated_duration_minutes'
  | 'planned_working_minutes'
  | 'location'
  | 'client_id'
  | 'project_id'
  | 'updated_at'
  | 'execution_version'
  | 'execution_state'
>;

type ParkedJobContext = { orgId: string; userId: string; isManagerOrAbove: boolean };

/**
 * The parked jobs a caller sees: every one for a manager, the assigned ones
 * for anyone else. Null after a logged failed assignment read.
 */
async function readParkedJobRows(
  admin: AdminClient,
  { orgId, userId, isManagerOrAbove }: ParkedJobContext,
): Promise<{ data: ParkedJobRow[]; error: { message: string } | null } | null> {
  if (isManagerOrAbove) {
    return readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select(PARKED_JOB_COLUMNS)
          .eq('organization_id', orgId)
          .eq('status', 'geparkt')
          .order('updated_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    );
  }
  const assignments = await readCompleteRows(
    (from, to) =>
      admin
        .from('job_assignments')
        .select('job_id')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (assignments.error) {
    logError('Error fetching parked job assignments:', assignments.error);
    return null;
  }
  const parkedJobs = await readInBatches(
    assignments.data.map((a) => a.job_id),
    (batch) =>
      admin
        .from('jobs')
        .select(PARKED_JOB_COLUMNS)
        .eq('organization_id', orgId)
        .eq('status', 'geparkt')
        .in('id', [...batch]),
  );
  parkedJobs.data.sort(
    (left, right) => left.updated_at.localeCompare(right.updated_at) || left.id.localeCompare(right.id),
  );
  return parkedJobs;
}

type ParkedJobLookups = {
  assignmentMap: Record<string, string[]>;
  clientMap: Record<string, { name: string; address: string | null }>;
  projectMap: Record<string, { name: string; number: string | null }>;
};

/** The assignees, customers and projects of the parked jobs; null after a logged failed read. */
async function readParkedJobLookups(
  admin: AdminClient,
  orgId: string,
  jobs: ParkedJobRow[],
): Promise<ParkedJobLookups | null> {
  const jobIds = jobs.map((j) => j.id);
  const clientIds = jobs.map((j) => j.client_id).filter((id): id is string => id !== null);
  const projectIds = jobs.map((j) => j.project_id).filter((id): id is string => id !== null);

  const [assignmentsResult, clientsResult, projectsResult] = await Promise.all([
    readInBatches(jobIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('job_assignments')
            .select('job_id, user_id')
            .eq('organization_id', orgId)
            .in('job_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(clientIds, (batch) =>
      admin
        .from('clients')
        .select('id, name, address')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('id, name, project_number')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
  ]);
  const relatedError = assignmentsResult.error ?? clientsResult.error ?? projectsResult.error;
  if (relatedError) {
    logError('Error fetching parked job details:', relatedError);
    return null;
  }

  const assignmentMap: Record<string, string[]> = {};
  for (const a of assignmentsResult.data || []) {
    (assignmentMap[a.job_id] ??= []).push(a.user_id);
  }

  const clientMap: Record<string, { name: string; address: string | null }> = {};
  for (const c of clientsResult.data || []) {
    clientMap[c.id] = {
      name: c.name,
      address: c.address,
    };
  }

  const projectMap: Record<string, { name: string; number: string | null }> = {};
  for (const p of projectsResult.data || []) {
    projectMap[p.id] = { name: p.name, number: p.project_number };
  }
  return { assignmentMap, clientMap, projectMap };
}

function toParkedCalendarJob(
  j: ParkedJobRow,
  { assignmentMap, clientMap, projectMap }: ParkedJobLookups,
): CalendarJob {
  return {
    id: j.id,
    jobNumber: j.job_number,
    title: getJobDisplayTitle({
      title: j.title,
      description: j.description,
    }),
    status: j.status,
    executionVersion: j.execution_version ?? 0,
    executionState: j.execution_state,
    priority: j.priority,
    plannedDate: j.planned_date,
    plannedTime: normalizeJobPlannedTime(j.planned_time),
    estimatedDurationMinutes: j.estimated_duration_minutes,
    plannedWorkingMinutes: j.planned_working_minutes,
    location: j.location,
    clientName: j.client_id ? (clientMap[j.client_id]?.name ?? null) : null,
    clientAddress: j.client_id ? (clientMap[j.client_id]?.address ?? null) : null,
    projectName: j.project_id ? (projectMap[j.project_id]?.name ?? null) : null,
    projectNumber: j.project_id ? (projectMap[j.project_id]?.number ?? null) : null,
    assignedUserIds: assignmentMap[j.id] || [],
  };
}

/** Parked jobs, those with status 'geparkt', as calendar rows. */
export async function readParkedCalendarJobs(
  admin: AdminClient,
  context: ParkedJobContext,
): Promise<ActionResult<{ jobs: CalendarJob[] }>> {
  const parkedJobs = await readParkedJobRows(admin, context);
  if (!parkedJobs) return { success: false, error: 'fetch_failed' };

  const { data: jobs, error: jobsError } = parkedJobs;

  if (jobsError) {
    logError('Error fetching parked jobs:', jobsError);
    return { success: false, error: 'fetch_failed' };
  }

  if (jobs.length === 0) {
    return { success: true, jobs: [] };
  }

  const lookups = await readParkedJobLookups(admin, context.orgId, jobs);
  if (!lookups) return { success: false, error: 'fetch_failed' };

  return { success: true, jobs: jobs.map((j) => toParkedCalendarJob(j, lookups)) };
}
