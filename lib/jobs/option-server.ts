import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database as DatabaseSchema } from '@/lib/supabase/database.types';

import { logReadErrors } from '@/lib/data/read-request-cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
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

/**
 * The option read behind the action's identity and input checks. The unit test drives
 * the read with a resolved context.
 * @internal
 */
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

/** Purposes that offer open jobs only. */
function offersOpenJobsOnly(input: Request): boolean {
  return (
    input.purpose === 'manual-entry' ||
    input.purpose === 'time-correction' ||
    (input.purpose === 'project-jobs' && !input.projectId)
  );
}

/**
 * The ids of the finished jobs the caller's own time names, legacy entries or
 * segments, so a correction of that time still shows its job. Null when a
 * read fails.
 */
async function jobsOfOwnTime(
  database: Database,
  context: AuthContext,
  finishedIds: readonly string[],
): Promise<Set<string> | null> {
  const [entries, segments] = await Promise.all([
    readInBatches(finishedIds, (ids) =>
      readCompleteRows(
        (from, to) =>
          database
            .from('time_entries')
            .select('id,job_id')
            .eq('organization_id', context.orgId)
            .eq('user_id', context.userId)
            .in('job_id', [...ids])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(finishedIds, (ids) =>
      readCompleteRows(
        (from, to) =>
          database
            .from('time_segments')
            .select('id,job_id,time_sessions!inner(user_id)')
            .eq('organization_id', context.orgId)
            .eq('time_sessions.user_id', context.userId)
            .in('job_id', [...ids])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  if (entries.error || segments.error) {
    logReadErrors('jobsOfOwnTime: read failed', entries.error, segments.error);
    return null;
  }
  return new Set([...entries.data, ...segments.data].flatMap((row) => (row.job_id ? [row.job_id] : [])));
}

/**
 * The selected jobs a picker resolves. A manager resolves every selected job
 * of the organization. An employee's selection follows the purpose's
 * open-jobs rule, except for a finished job of the caller's own time. Null
 * when a read fails.
 */
async function selectableJobs<Row extends { id: string; status: string }>(
  database: Database,
  context: AuthContext,
  input: Request,
  rows: Row[],
): Promise<Row[] | null> {
  const finishedIds = rows.flatMap((row) => (row.status === 'fertig' ? [row.id] : []));
  if (context.isManagerOrAbove || !offersOpenJobsOnly(input) || finishedIds.length === 0) return rows;
  const ownTime = await jobsOfOwnTime(database, context, finishedIds);
  return ownTime && rows.filter((row) => row.status !== 'fertig' || ownTime.has(row.id));
}

/**
 * The descriptions of the jobs among `rows` without a title, for a manager's
 * labels. Null when the read fails.
 */
async function descriptionsOfUntitledJobs(
  database: Database,
  context: AuthContext,
  rows: ReadonlyArray<{ id: string; title: string }>,
): Promise<Map<string, string | null> | null> {
  const untitledIds = rows.flatMap((row) => (row.title.trim() ? [] : [row.id]));
  const descriptions = await readInBatches(untitledIds, (ids) =>
    database
      .from('jobs')
      .select('id,description')
      .eq('organization_id', context.orgId)
      .in('id', [...ids]),
  );
  if (descriptions.error) {
    logReadErrors('descriptionsOfUntitledJobs: read failed', descriptions.error);
    return null;
  }
  return new Map(descriptions.data.map((row) => [row.id, row.description]));
}

/** The columns a job option is built from. */
type JobOptionRow = {
  id: string;
  title: string;
  job_number: string | null;
  client_id: string | null;
  project_id: string | null;
  status: string;
  job_assignments: { user_id: string }[];
};

/**
 * One job as a picker choice. The number leads, as people name a job by it. A
 * manager sees a job without a title by its description; an employee by its
 * number alone. A correction lists the whole organization's jobs, so the
 * caller's own stand out.
 */
function jobOption(
  row: JobOptionRow,
  context: AuthContext,
  input: Request,
  descriptions: Map<string, string | null>,
): JobEntityOption {
  const title = context.isManagerOrAbove
    ? getJobDisplayTitle({ title: row.title, description: descriptions.get(row.id) ?? null })
    : row.title.trim();
  const ownCorrectionJob =
    input.purpose === 'time-correction' &&
    row.job_assignments.some((assignment) => assignment.user_id === context.userId);
  return {
    value: row.id,
    label: [row.job_number, title].filter(Boolean).join(' · ') || '—',
    ...(ownCorrectionJob ? { description: 'Dir zugewiesen' } : {}),
    number: row.job_number,
    clientId: row.client_id,
    projectId: row.project_id,
    status: row.status,
  };
}

async function loadJobOptions(
  database: Database,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  // An employee never reads a job's description: not as a label, not as a
  // search term that would test hidden text with yes-or-no answers. The page
  // reads no description; a manager's labels add it below.
  const base = () => {
    let query = database
      .from('jobs')
      .select(
        readsOrganizationJobs(context, input)
          ? 'id,title,job_number,client_id,project_id,status,job_assignments(user_id)'
          : 'id,title,job_number,client_id,project_id,status,job_assignments!inner(user_id)',
      )
      .eq('organization_id', context.orgId);
    if (!readsOrganizationJobs(context, input)) query = query.eq('job_assignments.user_id', context.userId);
    return query;
  };
  const search = filterText(input.query);
  let query = base();
  // The purpose's eligibility applies before the page boundary.
  if (offersOpenJobsOnly(input)) query = query.neq('status', 'fertig');
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
    query = query.or(
      context.isManagerOrAbove
        ? `title.ilike.%${search}%,description.ilike.%${search}%,job_number.ilike.%${search}%`
        : `title.ilike.%${search}%,job_number.ilike.%${search}%`,
    );
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
  const selectable = await selectableJobs(database, context, input, selected.data);
  if (!selectable) return { success: false, error: 'options_failed' };
  const descriptions = context.isManagerOrAbove
    ? await descriptionsOfUntitledJobs(database, context, [...page.data, ...selected.data])
    : new Map<string, string | null>();
  if (!descriptions) return { success: false, error: 'options_failed' };
  const map = (row: JobOptionRow): JobEntityOption => jobOption(row, context, input, descriptions);
  return {
    success: true,
    options: page.data.slice(0, PAGE_SIZE).map(map),
    selected: selectable.map(map),
    hasMore: page.data.length > PAGE_SIZE,
  };
}
