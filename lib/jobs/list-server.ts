import 'server-only';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { authenticateAndAuthorize } from './auth';
import {
  JOB_LIST_SECTIONS,
  jobListPagesSchema,
  type JobListPages,
  type JobListQueries,
  type JobListSection,
} from './list-page';
import { toJob, toProject, type Job, type ProjectRow, type ProjectWithDetails } from './types';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches, readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';

type JobListEntry = JobListPages[JobListSection]['entries'][number];

/** The rows of the page's jobs and projects, and the jobs' assignments. */
async function readJobListRows(admin: AdminClient, orgId: string, entries: JobListEntry[]) {
  const jobIds = entries.filter((entry) => entry.type === 'standalone-job').map((entry) => entry.id);
  const projectIds = entries.filter((entry) => entry.type === 'project').map((entry) => entry.id);
  const [jobResult, projectResult, assignments] = await Promise.all([
    readInBatches(jobIds, (ids) =>
      admin
        .from('jobs')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(projectIds, (ids) =>
      admin
        .from('projects')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...ids]),
    ),
    readInBatches(jobIds, (ids) =>
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
  if (jobResult.error || projectResult.error || assignments.error)
    throw new Error('Aufträge konnten nicht geladen werden.');
  return { jobRows: jobResult.data, projectRows: projectResult.data, assignments: assignments.data };
}

/** The page's projects with the job counts the page read carries. */
function listProjects(projectRows: ProjectRow[], entries: JobListEntry[]): ProjectWithDetails[] {
  return projectRows.map((row) => {
    const entry = entries.find((entry) => entry.id === row.id && entry.type === 'project');
    if (!entry) throw new Error('Projekt konnte nicht geladen werden.');
    return {
      ...toProject(row),
      // The rows print the customer's name from `clientMap`.
      client: null,
      jobCount: entry.jobCount,
      completedJobCount: entry.completedJobCount,
      inProgressJobCount: entry.inProgressJobCount,
      parkedJobCount: entry.parkedJobCount,
    };
  });
}

export async function loadJobListPage(queries: JobListQueries): Promise<{
  jobs: Job[];
  projects: ProjectWithDetails[];
  jobAssignmentMap: Record<string, string[]>;
  clientMap: Record<string, string>;
  pagination: { queries: JobListQueries; pages: JobListPages };
}> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) throw new Error('Aufträge konnten nicht geladen werden.');
  const { orgId, userId, isManagerOrAbove } = auth.context;
  const admin = createSupabaseAdminClient();
  const result = await admin.rpc('list_job_entries_page', {
    p_organization_id: orgId,
    p_user_id: userId,
    p_is_manager: isManagerOrAbove,
    p_queries: queries,
  });
  if (result.error) throw new Error('Aufträge konnten nicht geladen werden.');
  const pages = jobListPagesSchema.parse(result.data);
  const entries = JOB_LIST_SECTIONS.flatMap((section) => pages[section].entries);
  const { jobRows, projectRows, assignments } = await readJobListRows(admin, orgId, entries);
  const clientIds = [
    ...new Set([...jobRows, ...projectRows].flatMap((row) => (row.client_id ? [row.client_id] : []))),
  ];
  const clientResult = await readInBatches(clientIds, (ids) =>
    admin
      .from('clients')
      .select('id, name')
      .eq('organization_id', orgId)
      .in('id', [...ids]),
  );
  if (clientResult.error) throw new Error('Kunden konnten nicht geladen werden.');
  const jobs: Job[] = jobRows.map(toJob);
  const projects = listProjects(projectRows, entries);
  const jobAssignmentMap: Record<string, string[]> = {};
  for (const assignment of assignments) (jobAssignmentMap[assignment.job_id] ??= []).push(assignment.user_id);
  return {
    jobs,
    projects,
    jobAssignmentMap,
    clientMap: Object.fromEntries(clientResult.data.map((client) => [client.id, client.name])),
    pagination: { queries, pages },
  };
}
