'use server';

import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { authenticateAndAuthorize } from './auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { entityIdPageSchema } from './list-page';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { toJob, type Job } from './types';

export type ProjectJobPageResult = { success: false; error: string } | {
  success: true; jobs: Job[]; total: number; clientMap: Record<string, string>; assignmentMap: Record<string, string[]>;
};

export async function getProjectJobPage(input: { projectId: string; page: number }): Promise<ProjectJobPageResult> {
  const parsed = z.object({ projectId: uuidSchema, page: z.number().int().min(1).max(1_000_000) }).safeParse(input);
  if (!parsed.success) return { success: false, error: 'Ungültige Seitenauswahl.' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: 'Aufträge konnten nicht geladen werden.' };
  const { orgId, userId, isManagerOrAbove } = auth.context;
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_project_job_page', { p_organization_id: orgId, p_user_id: userId, p_is_manager: isManagerOrAbove, p_project_id: parsed.data.projectId, p_page: parsed.data.page, p_page_size: LIST_PAGE_SIZE });
  const page = entityIdPageSchema.safeParse(selected.data);
  if (selected.error || !page.success) return { success: false, error: 'Aufträge konnten nicht geladen werden.' };
  if (!page.data.ids.length) return { success: true, jobs: [], total: page.data.total, clientMap: {}, assignmentMap: {} };
  const [jobs, assignments] = await Promise.all([
    admin.from('jobs').select('*').eq('organization_id', orgId).eq('project_id', input.projectId).in('id', page.data.ids),
    readCompleteRows((from, to) => admin.from('job_assignments').select('job_id,user_id').eq('organization_id', orgId).in('job_id', page.data.ids).order('id').range(from, to), LIST_ROW_CAP),
  ]);
  if (jobs.error || assignments.error) return { success: false, error: 'Aufträge konnten nicht geladen werden.' };
  const clientIds = [...new Set(jobs.data.flatMap((job) => job.client_id ? [job.client_id] : []))];
  const clients = clientIds.length ? await admin.from('clients').select('id,name').eq('organization_id', orgId).in('id', clientIds) : { data: [], error: null };
  if (clients.error) return { success: false, error: 'Kunden konnten nicht geladen werden.' };
  const assignmentMap: Record<string, string[]> = {};
  for (const assignment of assignments.data) (assignmentMap[assignment.job_id] ??= []).push(assignment.user_id);
  return { success: true, total: page.data.total, jobs: page.data.ids.flatMap((id) => { const job = jobs.data.find((row) => row.id === id); return job ? [toJob(job)] : []; }), assignmentMap, clientMap: Object.fromEntries(clients.data.map((client) => [client.id, client.name])) };
}
