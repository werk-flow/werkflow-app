import 'server-only';

import type { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { AuthContext } from './auth';
import { getJobDisplayTitle } from './types';
import type { JobEntityOption, JobOptionResult, jobOptionRequestSchema } from './option-types';

const PAGE_SIZE = 50;

export async function loadJobEntityOptions(
  context: AuthContext,
  input: z.output<typeof jobOptionRequestSchema>,
): Promise<JobOptionResult> {
  // Managers may browse their organization's options. Employee filters/manual
  // entries retain database RLS; a verified identity alone grants no admin read.
  if (!context.isManagerOrAbove && (input.kind === 'projects' || (input.purpose !== 'filter' && input.purpose !== 'manual-entry'))) {
    return { success: false, error: 'not_authorized' };
  }
  const database = context.isManagerOrAbove ? createSupabaseAdminClient() : await createSupabaseServerClient();
  const search = input.query.replace(/[\\%_,().]/g, ' ').trim();
  if (input.kind === 'clients') {
    const base = () => database.from('clients').select('id,name,email').eq('organization_id', context.orgId);
    let query = base();
    if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    const [page, selected] = await Promise.all([
      query.order('name').order('id').range(input.offset, input.offset + PAGE_SIZE),
      readInBatches(input.selectedIds, (ids) => base().in('id', [...ids])),
    ]);
    if (page.error || selected.error) return { success: false, error: 'options_failed' };
    const map = (row: { id: string; name: string; email: string | null }): JobEntityOption => ({ value: row.id, label: row.name, description: row.email ?? undefined });
    return { success: true, options: page.data.slice(0, PAGE_SIZE).map(map), selected: selected.data.map(map), hasMore: page.data.length > PAGE_SIZE };
  }
  if (input.kind === 'projects') {
    const base = () => database.from('projects').select('id,name,project_number,client_id,status_override,jobs(count),completed:jobs(count)').eq('organization_id', context.orgId).eq('completed.status', 'fertig');
    let query = base();
    if (search) query = query.or(`name.ilike.%${search}%,project_number.ilike.%${search}%`);
    if (input.clientId) query = query.or(`client_id.is.null,client_id.eq.${input.clientId}`);
    const [page, selected] = await Promise.all([
      query.order('name').order('id').range(input.offset, input.offset + PAGE_SIZE),
      readInBatches(input.selectedIds, (ids) => base().in('id', [...ids])),
    ]);
    if (page.error || selected.error) return { success: false, error: 'options_failed' };
    const map = (row: (typeof page.data)[number]): JobEntityOption => ({ value: row.id, label: row.project_number ? `${row.project_number} – ${row.name}` : row.name, clientId: row.client_id });
    const eligible = page.data.slice(0, PAGE_SIZE).filter((row) => input.purpose !== 'job-project' || (row.status_override ? row.status_override !== 'abgeschlossen' : !((row.jobs[0]?.count ?? 0) > 0 && row.jobs[0]?.count === row.completed[0]?.count)));
    return { success: true, options: eligible.map(map), selected: selected.data.map(map), hasMore: page.data.length > PAGE_SIZE };
  }
  const base = () => {
    let query = database.from('jobs').select(context.isManagerOrAbove
      ? 'id,title,description,job_number,client_id,project_id,status,job_assignments(user_id)'
      : 'id,title,description,job_number,client_id,project_id,status,job_assignments!inner(user_id)').eq('organization_id', context.orgId);
    if (!context.isManagerOrAbove) query = query.eq('job_assignments.user_id', context.userId);
    return query;
  };
  let query = base();
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,job_number.ilike.%${search}%`);
  if (input.purpose === 'manual-entry' || (input.purpose === 'project-jobs' && !input.projectId)) query = query.neq('status', 'fertig');
  if (input.purpose === 'project-jobs') {
    query = input.projectId ? query.or(`project_id.is.null,project_id.eq.${input.projectId}`) : query.is('project_id', null);
    if (input.clientId) query = query.or(`client_id.is.null,client_id.eq.${input.clientId}${input.projectId ? `,project_id.eq.${input.projectId}` : ''}`);
  }
  const [page, selected] = await Promise.all([
    query.order('title').order('id').range(input.offset, input.offset + PAGE_SIZE),
    readInBatches(input.selectedIds, (ids) => base().in('id', [...ids])),
  ]);
  if (page.error || selected.error) return { success: false, error: 'options_failed' };
  const map = (row: (typeof page.data)[number]): JobEntityOption => ({ value: row.id, label: getJobDisplayTitle(row), description: row.job_number ?? undefined, clientId: row.client_id, projectId: row.project_id, status: row.status });
  return { success: true, options: page.data.slice(0, PAGE_SIZE).map(map), selected: selected.data.map(map), hasMore: page.data.length > PAGE_SIZE };
}
