import 'server-only';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { toClient, toJob, toProject, type Client, type Job, type ProjectWithDetails } from '@/lib/jobs/types';
import type { OrganizationDocument, DocumentEmployee } from './types';

/** Context headings need only the current document page's linked targets. */
export async function loadDocumentPageContext(documents: OrganizationDocument[]): Promise<{
  jobs: Job[];
  projects: ProjectWithDetails[];
  clients: Client[];
  employees: DocumentEmployee[];
}> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success || !auth.context.isManagerOrAbove) throw new Error('Dokumente konnten nicht geladen werden.');
  const { orgId } = auth.context;
  const admin = createSupabaseAdminClient();
  const links = documents.flatMap((document) => document.links);
  const jobIds = [...new Set(links.flatMap((link) => link.jobId ? [link.jobId] : []))];
  const jobs = await readInBatches(jobIds, (ids) => admin.from('jobs').select('*').eq('organization_id', orgId).in('id', [...ids]));
  if (jobs.error) throw new Error('Aufträge konnten nicht geladen werden.');
  const projectIds = [...new Set([...links.flatMap((link) => link.projectId ? [link.projectId] : []), ...jobs.data.flatMap((job) => job.project_id ? [job.project_id] : [])])];
  const [projects, clients] = await Promise.all([
    readInBatches(projectIds, (ids) => admin.from('projects').select('*').eq('organization_id', orgId).in('id', [...ids])),
    readInBatches([...new Set(links.flatMap((link) => link.clientId ? [link.clientId] : []))], (ids) => admin.from('clients').select('*').eq('organization_id', orgId).in('id', [...ids])),
  ]);
  if (projects.error || clients.error) throw new Error('Verknüpfungen konnten nicht geladen werden.');
  const employeeIds = [...new Set(links.flatMap((link) => link.employeeId ? [link.employeeId] : []))];
  const employees: DocumentEmployee[] = employeeIds.map((id) => { const link = links.find((link) => link.employeeId === id); return { userId: id, name: link?.employeeName ?? '', email: link?.employeeEmail ?? null }; });
  const projectRows: ProjectWithDetails[] = projects.data.map((project) => ({ ...toProject(project), client: null, jobCount: 0, completedJobCount: 0, inProgressJobCount: 0, parkedJobCount: 0 }));
  return { jobs: jobs.data.map(toJob), projects: projectRows, clients: clients.data.map(toClient), employees };
}
