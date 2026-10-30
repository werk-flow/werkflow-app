import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  toClient,
  toJob,
  toProject,
  type ClientRow,
  type Job,
  type JobAssignmentRow,
  type JobRow,
  type ProjectRow,
  type ProjectWithDetails,
} from './types';

// The readers behind getJobsForClient and getJobsForMember in ./actions.
// The caller has established a manager's right to read the organization's work.

/** The jobs related to one client or one member, with their projects, client names and assignments. */
export type RelatedJobs = {
  jobs: Job[];
  projects: ProjectWithDetails[];
  clientMap: Record<string, string>;
  jobAssignmentMap: Record<string, string[]>;
};

type JobPlanOrderRow = Pick<JobRow, 'planned_date' | 'created_at' | 'id'>;

/** The job list order (planned date, newest first, id), restored after a batched read. */
function compareJobRowsByPlan(left: JobPlanOrderRow, right: JobPlanOrderRow): number {
  if (left.planned_date !== right.planned_date) {
    if (left.planned_date === null) return 1;
    if (right.planned_date === null) return -1;
    return left.planned_date < right.planned_date ? -1 : 1;
  }
  return right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id);
}

/**
 * The client's own jobs, the projects they and the client's projects belong
 * to, and every job of those projects; null after a logged failed read.
 */
async function readClientJobRows(
  admin: AdminClient,
  orgId: string,
  clientId: string,
): Promise<{ jobRows: JobRow[]; projects: ProjectRow[]; projectJobs: JobRow[] } | null> {
  const [directJobs, clientProjects] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('*')
          .eq('organization_id', orgId)
          .eq('client_id', clientId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('projects')
          .select('*')
          .eq('organization_id', orgId)
          .eq('client_id', clientId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);
  if (directJobs.error || clientProjects.error) {
    logReadErrors('getJobsForClient: read failed', directJobs.error, clientProjects.error);
    return null;
  }
  const projectIds = [
    ...new Set([
      ...clientProjects.data.map((project) => project.id),
      ...directJobs.data.flatMap((job) => (job.project_id ? [job.project_id] : [])),
    ]),
  ];
  const [allProjects, projectJobs] = await Promise.all([
    readInBatches(projectIds, (ids) =>
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(projectIds, (ids) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('jobs')
            .select('*')
            .eq('organization_id', orgId)
            .in('project_id', [...ids])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (allProjects.error || projectJobs.error || projectJobs.data.length > LIST_ROW_CAP) {
    logReadErrors('getJobsForClient: read failed', allProjects.error, projectJobs.error);
    return null;
  }
  const directProjectIds = new Set(clientProjects.data.map((project) => project.id));
  const jobRows = new Map(directJobs.data.map((job) => [job.id, job]));
  for (const job of projectJobs.data)
    if (job.project_id && directProjectIds.has(job.project_id)) jobRows.set(job.id, job);
  return { jobRows: [...jobRows.values()], projects: allProjects.data, projectJobs: projectJobs.data };
}

/**
 * All jobs and projects associated with one client: the jobs directly linked
 * to the client and the jobs of the projects linked to the client.
 */
export async function readJobsOfClient(
  admin: AdminClient,
  orgId: string,
  clientId: string,
): Promise<ActionResult<RelatedJobs>> {
  const rows = await readClientJobRows(admin, orgId, clientId);
  if (!rows) return { success: false, error: 'fetch_failed' };
  const jobs = rows.jobRows.map(toJob);
  if (jobs.length > LIST_ROW_CAP) return { success: false, error: 'fetch_failed' };
  const clientIds = [
    ...new Set([...rows.projects, ...rows.jobRows].flatMap((row) => (row.client_id ? [row.client_id] : []))),
  ];
  const [clients, assignments] = await Promise.all([
    readInBatches(clientIds, (ids) =>
      admin
        .from('clients')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(
      jobs.map((job) => job.id),
      (ids) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('job_assignments')
              .select('job_id,user_id')
              .eq('organization_id', orgId)
              .in('job_id', [...ids])
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
    ),
  ]);
  if (clients.error || assignments.error || assignments.data.length > LIST_ROW_CAP * 4) {
    logReadErrors('getJobsForClient: read failed', clients.error, assignments.error);
    return { success: false, error: 'fetch_failed' };
  }
  const clientLookup = new Map(clients.data.map((client) => [client.id, toClient(client)]));
  const projects: ProjectWithDetails[] = rows.projects.map((project) => {
    const children = rows.projectJobs.filter((job) => job.project_id === project.id);
    return {
      ...toProject(project),
      client: project.client_id ? (clientLookup.get(project.client_id) ?? null) : null,
      jobCount: children.length,
      completedJobCount: children.filter((job) => job.status === 'fertig').length,
      inProgressJobCount: children.filter((job) => job.status === 'in_bearbeitung').length,
      parkedJobCount: children.filter((job) => job.status === 'geparkt').length,
    };
  });
  const jobAssignmentMap: Record<string, string[]> = {};
  for (const assignment of assignments.data)
    (jobAssignmentMap[assignment.job_id] ??= []).push(assignment.user_id);
  return {
    success: true,
    jobs,
    projects,
    clientMap: Object.fromEntries(clients.data.map((client) => [client.id, client.name])),
    jobAssignmentMap,
  };
}

type ProjectJobCounts = { total: number; completed: number; inProgress: number; parked: number };

/** The member's projects with their job counts by status and their customer. */
function memberProjects(
  projectRows: ProjectRow[],
  projectJobs: Pick<JobRow, 'id' | 'project_id' | 'status'>[],
  clientRows: ClientRow[],
): ProjectWithDetails[] {
  const jobsByProject = new Map<string, ProjectJobCounts>();
  for (const projectJob of projectJobs) {
    if (!projectJob.project_id) continue;
    const entry = jobsByProject.get(projectJob.project_id) ?? {
      total: 0,
      completed: 0,
      inProgress: 0,
      parked: 0,
    };
    entry.total++;
    if (projectJob.status === 'fertig') entry.completed++;
    if (projectJob.status === 'in_bearbeitung') entry.inProgress++;
    if (projectJob.status === 'geparkt') entry.parked++;
    jobsByProject.set(projectJob.project_id, entry);
  }
  const clientLookup = new Map(clientRows.map((client) => [client.id, client]));
  return projectRows.map((row) => {
    const counts = jobsByProject.get(row.id) ?? { total: 0, completed: 0, inProgress: 0, parked: 0 };
    const client = row.client_id ? clientLookup.get(row.client_id) : undefined;
    return {
      ...toProject(row),
      client: client ? toClient(client) : null,
      jobCount: counts.total,
      completedJobCount: counts.completed,
      inProgressJobCount: counts.inProgress,
      parkedJobCount: counts.parked,
    };
  });
}

/**
 * The projects, project jobs, assignments and customers of the member's jobs;
 * null after a logged failed read.
 */
async function readMemberJobRelations(
  admin: AdminClient,
  orgId: string,
  member: { jobs: Job[]; jobRows: JobRow[]; assignedJobIds: string[] },
): Promise<{
  projects: ProjectWithDetails[];
  clientRows: ClientRow[];
  assignments: Pick<JobAssignmentRow, 'job_id' | 'user_id'>[];
} | null> {
  const projectIds = member.jobs.flatMap((job) => (job.projectId ? [job.projectId] : []));
  const [projectRows, projectJobs, allAssignments] = await Promise.all([
    readInBatches(projectIds, (batch) =>
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(projectIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('jobs')
            .select('id, project_id, status')
            .eq('organization_id', orgId)
            .in('project_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(member.assignedJobIds, (batch) =>
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
  ]);
  const clientIds = [...projectRows.data, ...member.jobRows].flatMap((row) =>
    row.client_id ? [row.client_id] : [],
  );
  const clientRows = await readInBatches(clientIds, (batch) =>
    admin
      .from('clients')
      .select('*')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  const relatedError = projectRows.error ?? projectJobs.error ?? allAssignments.error ?? clientRows.error;
  if (relatedError) {
    logError('Error fetching member job details:', relatedError);
    return null;
  }
  return {
    projects: memberProjects(projectRows.data, projectJobs.data, clientRows.data),
    clientRows: clientRows.data,
    assignments: allAssignments.data,
  };
}

/**
 * All jobs assigned to one member, along with their parent projects, client
 * names, and the full assignment map for those jobs.
 */
export async function readJobsOfMember(
  admin: AdminClient,
  orgId: string,
  memberId: string,
): Promise<ActionResult<RelatedJobs>> {
  const { data: assignments, error: assignError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('job_assignments')
        .select('job_id')
        .eq('organization_id', orgId)
        .eq('user_id', memberId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );

  if (assignError) {
    logError('Error fetching member assignments:', assignError);
    return { success: false, error: 'fetch_failed' };
  }

  const assignedJobIds = [...new Set(assignments.map((a) => a.job_id))];

  if (assignedJobIds.length === 0) {
    return {
      success: true,
      jobs: [],
      projects: [],
      clientMap: {},
      jobAssignmentMap: {},
    };
  }

  const { data: jobRows, error: jobError } = await readInBatches(assignedJobIds, (batch) =>
    admin
      .from('jobs')
      .select('*')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );

  if (jobError) {
    logError('Error fetching member jobs:', jobError);
    return { success: false, error: 'fetch_failed' };
  }

  const jobs = jobRows.sort(compareJobRowsByPlan).map(toJob);
  const related = await readMemberJobRelations(admin, orgId, { jobs, jobRows, assignedJobIds });
  if (!related) return { success: false, error: 'fetch_failed' };

  const jobAssignmentMap: Record<string, string[]> = {};
  for (const a of related.assignments) {
    (jobAssignmentMap[a.job_id] ??= []).push(a.user_id);
  }

  return {
    success: true,
    jobs,
    projects: related.projects,
    clientMap: Object.fromEntries(related.clientRows.map((client) => [client.id, client.name])),
    jobAssignmentMap,
  };
}
