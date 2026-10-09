import 'server-only';

import { logReadErrors } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { AuthContext } from './auth';
import type { JobEntityOption, JobOptionResult, jobOptionRequestSchema } from './option-types';

// The picker kinds that a service-only SQL search serves (managers only; the
// dispatcher in option-server.ts checks the role). Each SQL reader applies its
// filters before the page boundary and orders by natural record number.

type Request = z.output<typeof jobOptionRequestSchema>;
type Admin = ReturnType<typeof createSupabaseAdminClient>;

const PAGE_SIZE = 50;
const FAILED: JobOptionResult = { success: false, error: 'options_failed' };

function pageSchema<Row extends z.ZodTypeAny>(row: Row) {
  return z.object({ options: z.array(row).max(PAGE_SIZE), hasMore: z.boolean() });
}

const projectRow = z.object({
  id: uuidSchema,
  projectNumber: z.string().nullable(),
  name: z.string(),
  clientId: uuidSchema.nullable(),
  clientName: z.string().nullable(),
  siteId: uuidSchema.nullable(),
  contactId: uuidSchema.nullable(),
  statusOverride: z.string().nullable(),
  jobCount: z.number().int(),
  completedJobCount: z.number().int(),
});
const inventoryRow = z.object({
  id: uuidSchema,
  name: z.string(),
  unit: z.string(),
  internalSku: z.string().nullable(),
  isBillable: z.boolean(),
});
const serviceCaseRow = z.object({
  id: uuidSchema,
  caseNumber: z.string(),
  summary: z.string(),
  clientId: uuidSchema,
  siteId: uuidSchema,
  status: z.string(),
});
const coverageRow = z.object({
  id: uuidSchema,
  coverageNumber: z.string(),
  reference: z.string().nullable(),
  clientId: uuidSchema,
  siteId: uuidSchema,
});

function projectOption(row: z.output<typeof projectRow>): JobEntityOption {
  return {
    value: row.id,
    label: row.projectNumber ? `${row.projectNumber} – ${row.name}` : row.name,
    description: row.clientName ?? undefined,
    number: row.projectNumber,
    name: row.name,
    clientId: row.clientId,
    clientName: row.clientName,
    siteId: row.siteId,
    contactId: row.contactId,
    statusOverride: row.statusOverride,
    jobCount: row.jobCount,
    completedJobCount: row.completedJobCount,
  };
}

/** Projects: the job-project purpose offers open ones only; equipment work those at the site. */
export async function loadProjectOptions(
  admin: Admin,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  const [page, selected] = await Promise.all([
    admin.rpc('search_project_options', {
      p_organization_id: context.orgId,
      p_search: input.query,
      p_open_only: input.purpose === 'job-project',
      p_offset: input.offset,
      ...(input.clientId ? { p_client_id: input.clientId } : {}),
      ...(input.purpose === 'equipment-work' && input.siteId ? { p_site_id: input.siteId } : {}),
    }),
    readInBatches(input.selectedIds, (ids) =>
      admin
        .from('projects')
        .select(
          'id,name,project_number,client_id,site_id,contact_id,status_override,client:clients(name),jobs(count),completed:jobs(count)',
        )
        .eq('organization_id', context.orgId)
        .eq('completed.status', 'fertig')
        .in('id', [...ids]),
    ),
  ]);
  const parsed = pageSchema(projectRow).safeParse(page.data);
  if (page.error || selected.error || !parsed.success) {
    logReadErrors('loadProjectOptions: read failed', page.error, selected.error);
    return FAILED;
  }
  return {
    success: true,
    options: parsed.data.options.map(projectOption),
    selected: selected.data.map((row) =>
      projectOption({
        id: row.id,
        projectNumber: row.project_number,
        name: row.name,
        clientId: row.client_id,
        clientName: row.client?.name ?? null,
        siteId: row.site_id,
        contactId: row.contact_id,
        statusOverride: row.status_override,
        jobCount: row.jobs[0]?.count ?? 0,
        completedJobCount: row.completed[0]?.count ?? 0,
      }),
    ),
    hasMore: parsed.data.hasMore,
  };
}

function inventoryOption(row: z.output<typeof inventoryRow>): JobEntityOption {
  return {
    value: row.id,
    label: row.name,
    description: row.internalSku ?? undefined,
    unit: row.unit,
    isBillable: row.isBillable,
  };
}

/** Active inventory items, searched literally over name, SKU, manufacturer and barcodes. */
export async function loadInventoryItemOptions(
  admin: Admin,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  const [page, selected] = await Promise.all([
    admin.rpc('search_inventory_item_options', {
      p_organization_id: context.orgId,
      p_search: input.query,
      p_offset: input.offset,
    }),
    readInBatches(input.selectedIds, (ids) =>
      admin
        .from('inventory_items')
        .select('id,name,unit,internal_sku,is_billable')
        .eq('organization_id', context.orgId)
        .in('id', [...ids]),
    ),
  ]);
  const parsed = pageSchema(inventoryRow).safeParse(page.data);
  if (page.error || selected.error || !parsed.success) {
    logReadErrors('loadInventoryItemOptions: read failed', page.error, selected.error);
    return FAILED;
  }
  return {
    success: true,
    options: parsed.data.options.map(inventoryOption),
    selected: selected.data.map((row) =>
      inventoryOption({
        id: row.id,
        name: row.name,
        unit: row.unit,
        internalSku: row.internal_sku,
        isBillable: row.is_billable,
      }),
    ),
    hasMore: parsed.data.hasMore,
  };
}

function serviceCaseOption(row: z.output<typeof serviceCaseRow>): JobEntityOption {
  return {
    value: row.id,
    label: `${row.caseNumber} · ${row.summary}`,
    number: row.caseNumber,
    clientId: row.clientId,
    siteId: row.siteId,
    status: row.status,
  };
}

/** Service cases of every status, optionally of one customer and site. */
export async function loadServiceCaseOptions(
  admin: Admin,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  const [page, selected] = await Promise.all([
    admin.rpc('search_service_case_options', {
      p_organization_id: context.orgId,
      p_search: input.query,
      p_offset: input.offset,
      ...(input.clientId ? { p_client_id: input.clientId } : {}),
      ...(input.siteId ? { p_site_id: input.siteId } : {}),
    }),
    readInBatches(input.selectedIds, (ids) =>
      admin
        .from('service_cases')
        .select('id,case_number,summary,client_id,site_id,status')
        .eq('organization_id', context.orgId)
        .in('id', [...ids]),
    ),
  ]);
  const parsed = pageSchema(serviceCaseRow).safeParse(page.data);
  if (page.error || selected.error || !parsed.success) {
    logReadErrors('loadServiceCaseOptions: read failed', page.error, selected.error);
    return FAILED;
  }
  return {
    success: true,
    options: parsed.data.options.map(serviceCaseOption),
    selected: selected.data.map((row) =>
      serviceCaseOption({
        id: row.id,
        caseNumber: row.case_number,
        summary: row.summary,
        clientId: row.client_id,
        siteId: row.site_id,
        status: row.status,
      }),
    ),
    hasMore: parsed.data.hasMore,
  };
}

function coverageOption(row: z.output<typeof coverageRow>): JobEntityOption {
  return {
    value: row.id,
    label: row.coverageNumber,
    description: row.reference ?? undefined,
    number: row.coverageNumber,
    clientId: row.clientId,
    siteId: row.siteId,
  };
}

/** Maintenance coverages, optionally of one customer and site. */
export async function loadCoverageOptions(
  admin: Admin,
  context: AuthContext,
  input: Request,
): Promise<JobOptionResult> {
  const [page, selected] = await Promise.all([
    admin.rpc('search_coverage_options', {
      p_organization_id: context.orgId,
      p_search: input.query,
      p_offset: input.offset,
      ...(input.clientId ? { p_client_id: input.clientId } : {}),
      ...(input.siteId ? { p_site_id: input.siteId } : {}),
    }),
    readInBatches(input.selectedIds, (ids) =>
      admin
        .from('maintenance_coverages')
        .select('id,coverage_number,reference,client_id,site_id')
        .eq('organization_id', context.orgId)
        .in('id', [...ids]),
    ),
  ]);
  const parsed = pageSchema(coverageRow).safeParse(page.data);
  if (page.error || selected.error || !parsed.success) {
    logReadErrors('loadCoverageOptions: read failed', page.error, selected.error);
    return FAILED;
  }
  return {
    success: true,
    options: parsed.data.options.map(coverageOption),
    selected: selected.data.map((row) =>
      coverageOption({
        id: row.id,
        coverageNumber: row.coverage_number,
        reference: row.reference,
        clientId: row.client_id,
        siteId: row.site_id,
      }),
    ),
    hasMore: parsed.data.hasMore,
  };
}
