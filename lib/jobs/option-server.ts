import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database as DatabaseSchema } from '@/lib/supabase/database.types';

import { logReadErrors } from '@/lib/data/read-request-cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { authenticateAndAuthorize, type AuthContext } from './auth';
import {
  loadCoverageOptions,
  loadInventoryItemOptions,
  loadProjectOptions,
  loadServiceCaseOptions,
} from './option-records';
import { getJobDisplayTitle } from './types';
import {
  jobOptionRequestSchema,
  type JobEntityOption,
  type JobOptionRequest,
  type JobOptionResult,
} from './option-types';

type Request = z.output<typeof jobOptionRequestSchema>;
/** The caller's RLS client for employees, the admin client for managers. */
type Database = SupabaseClient<DatabaseSchema>;

const PAGE_SIZE = 50;

const equipmentOptionPageSchema = z.object({
  options: z
    .array(z.object({ id: uuidSchema, equipmentNumber: z.string(), name: z.string(), clientId: uuidSchema }))
    .max(PAGE_SIZE),
  hasMore: z.boolean(),
});

/** Kinds and purposes an employee may read; everything else is a manager's picker. */
function employeeMayRead(input: Request): boolean {
  return (
    (input.kind === 'clients' || input.kind === 'jobs') &&
    (input.purpose === 'filter' || input.purpose === 'manual-entry' || input.purpose === 'time-correction')
  );
}

/**
 * A time correction may name any open job of the organization, whoever
 * submits it (the correction action checks the job's organization again), so
 * that purpose reads with the admin client for every member: open jobs only,
 * number and title only.
 */
function readsOrganizationJobs(context: AuthContext, input: Request): boolean {
  return context.isManagerOrAbove || (input.kind === 'jobs' && input.purpose === 'time-correction');
}

/**
 * The entity-picker reader behind the background read `'entity-options'`.
 * It establishes the caller again (the read-request scope shares the
 * identity read with the route), requires the requested organization to be
 * the active one and then reads one page.
 */
export async function readEntityOptions(input: JobOptionRequest): Promise<JobOptionResult> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  const parsed = jobOptionRequestSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  if (parsed.data.organizationId !== auth.context.orgId)
    return { success: false, error: 'organization_changed' };
  return loadJobEntityOptions(auth.context, parsed.data);
}

export async function loadJobEntityOptions(context: AuthContext, input: Request): Promise<JobOptionResult> {
  // Managers browse their organization's options. Employee filters and manual
  // entries keep database RLS; a verified identity alone grants no admin read.
  if (!context.isManagerOrAbove && !employeeMayRead(input))
    return { success: false, error: 'not_authorized' };
  if (readsOrganizationJobs(context, input)) {
    const admin = createSupabaseAdminClient();
    if (input.kind === 'projects') return loadProjectOptions(admin, context, input);
    if (input.kind === 'inventory-items') return loadInventoryItemOptions(admin, context, input);
    if (input.kind === 'service-cases') return loadServiceCaseOptions(admin, context, input);
    if (input.kind === 'coverages') return loadCoverageOptions(admin, context, input);
    if (input.kind === 'equipment') return loadEquipmentOptions(admin, context, input);
    if (input.kind === 'clients') return loadClientOptions(admin, context, input);
    return loadJobOptions(admin, context, input);
  }
  const database = await createSupabaseServerClient();
  return input.kind === 'clients'
    ? loadClientOptions(database, context, input)
    : loadJobOptions(database, context, input);
}

/** Search text without the characters PostgREST filter strings treat as syntax, quoting or wildcards. */
function filterText(query: string): string {
  return query.replace(/[\\%_,().*"]/g, ' ').trim();
}

async function loadClientOptions(
  database: Database,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  const base = () => database.from('clients').select('id,name,email').eq('organization_id', context.orgId);
  const search = filterText(input.query);
  let query = base();
  if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
  const [page, selected] = await Promise.all([
    query
      .order('name')
      .order('id')
      .range(input.offset, input.offset + PAGE_SIZE),
    readInBatches(input.selectedIds, (ids) => base().in('id', [...ids])),
  ]);
  if (page.error || selected.error) {
    logReadErrors('loadClientOptions: read failed', page.error, selected.error);
    return { success: false, error: 'options_failed' };
  }
  const map = (row: { id: string; name: string; email: string | null }): JobEntityOption => ({
    value: row.id,
    label: row.name,
    description: row.email ?? undefined,
  });
  return {
    success: true,
    options: page.data.slice(0, PAGE_SIZE).map(map),
    selected: selected.data.map(map),
    hasMore: page.data.length > PAGE_SIZE,
  };
}

async function loadEquipmentOptions(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  // The database selects the page in natural number order, so ANL-2026-1000
  // follows ANL-2026-101 on every page.
  const [page, selected] = await Promise.all([
    admin.rpc('search_equipment_options', {
      p_organization_id: context.orgId,
      p_search: input.query,
      p_offset: input.offset,
      ...(input.clientId ? { p_client_id: input.clientId } : {}),
    }),
    readInBatches(input.selectedIds, (ids) =>
      admin
        .from('installed_equipment')
        .select('id,equipment_number,name,client_id')
        .eq('organization_id', context.orgId)
        .is('voided_at', null)
        .in('id', [...ids]),
    ),
  ]);
  const parsedPage = equipmentOptionPageSchema.safeParse(page.data);
  if (page.error || selected.error || !parsedPage.success) {
    logReadErrors('loadEquipmentOptions: read failed', page.error, selected.error);
    return { success: false, error: 'options_failed' };
  }
  const map = (row: {
    id: string;
    equipmentNumber: string;
    name: string;
    clientId: string;
  }): JobEntityOption => ({
    value: row.id,
    label: `${row.equipmentNumber} · ${row.name}`,
    number: row.equipmentNumber,
    clientId: row.clientId,
  });
  return {
    success: true,
    options: parsedPage.data.options.map(map),
    selected: selected.data.map((row) =>
      map({ id: row.id, equipmentNumber: row.equipment_number, name: row.name, clientId: row.client_id }),
    ),
    hasMore: parsedPage.data.hasMore,
  };
}

async function loadJobOptions(
  database: Database,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  const base = () => {
    let query = database
      .from('jobs')
      .select(
        readsOrganizationJobs(context, input)
          ? 'id,title,description,job_number,client_id,project_id,status,job_assignments(user_id)'
          : 'id,title,description,job_number,client_id,project_id,status,job_assignments!inner(user_id)',
      )
      .eq('organization_id', context.orgId);
    if (!readsOrganizationJobs(context, input)) query = query.eq('job_assignments.user_id', context.userId);
    return query;
  };
  const search = filterText(input.query);
  let query = base();
  // The purpose's eligibility applies before the page boundary.
  if (
    input.purpose === 'manual-entry' ||
    input.purpose === 'time-correction' ||
    (input.purpose === 'project-jobs' && !input.projectId)
  )
    query = query.neq('status', 'fertig');
  if (input.purpose === 'project-jobs') {
    query = input.projectId
      ? query.or(`project_id.is.null,project_id.eq.${input.projectId}`)
      : query.is('project_id', null);
    if (input.clientId)
      query = query.or(
        `client_id.is.null,client_id.eq.${input.clientId}${input.projectId ? `,project_id.eq.${input.projectId}` : ''}`,
      );
  }
  if (input.purpose === 'equipment-work') {
    if (input.clientId) query = query.eq('client_id', input.clientId);
    if (input.siteId) query = query.eq('site_id', input.siteId);
  }
  if (search)
    query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,job_number.ilike.%${search}%`);
  const [page, selected] = await Promise.all([
    query
      .order('title')
      .order('id')
      .range(input.offset, input.offset + PAGE_SIZE),
    readInBatches(input.selectedIds, (ids) => base().in('id', [...ids])),
  ]);
  if (page.error || selected.error) {
    logReadErrors('loadJobOptions: read failed', page.error, selected.error);
    return { success: false, error: 'options_failed' };
  }
  const map = (row: (typeof page.data)[number]): JobEntityOption => ({
    value: row.id,
    // The number leads, as people name a job by it; a job without one shows its title.
    label: [row.job_number, getJobDisplayTitle(row)].filter(Boolean).join(' · '),
    number: row.job_number,
    clientId: row.client_id,
    projectId: row.project_id,
    status: row.status,
  });
  return {
    success: true,
    options: page.data.slice(0, PAGE_SIZE).map(map),
    selected: selected.data.map(map),
    hasMore: page.data.length > PAGE_SIZE,
  };
}
