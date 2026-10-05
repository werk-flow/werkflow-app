import 'server-only';

import { z } from '@/lib/zod';

import type { ActionResult } from '@/lib/action-result';
import { formatSiteRowAddress } from '@/lib/clients/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { serviceCaseListQuerySchema, type ServiceCaseListQuery, type ServiceCasePage } from './list-page';
import { requireServiceManager, type ServiceAdminClient as AdminClient } from './manager-context';
import type { ServiceCaseEquipment, ServiceCaseListItem, ServiceCaseRow } from './types';

/**
 * Hydrates service-case rows of one organization into list items: customer,
 * site, job and linked equipment. A failed related read throws instead of
 * returning a shortened list.
 */
export async function hydrateListItems(
  admin: AdminClient,
  organizationId: string,
  rows: ServiceCaseRow[],
): Promise<ServiceCaseListItem[]> {
  if (rows.length === 0) return [];
  const clientIds = [...new Set(rows.map((row) => row.client_id))];
  const siteIds = [...new Set(rows.map((row) => row.site_id))];
  const jobIds = [...new Set(rows.flatMap((row) => (row.job_id ? [row.job_id] : [])))];
  const caseIds = rows.map((row) => row.id);
  const [clientsResult, sitesResult, jobsResult, linksResult] = await Promise.all([
    readInBatches(clientIds, (batch) =>
      admin
        .from('clients')
        .select('id, name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(siteIds, (batch) =>
      admin
        .from('client_sites')
        .select('id, name, street, postal_code, city')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(jobIds, (batch) =>
      admin
        .from('jobs')
        .select('id, job_number, title')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
    readInBatches(caseIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('service_case_equipment_links')
            .select('service_case_id, equipment_id')
            .eq('organization_id', organizationId)
            .in('service_case_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const hydrationError = clientsResult.error ?? sitesResult.error ?? jobsResult.error ?? linksResult.error;
  if (hydrationError) {
    logReadFailure('hydrateListItems: service case hydration read failed', {
      code: hydrationError.code,
      message: hydrationError.message,
    });
    throw new Error('service_case_hydration_failed');
  }
  const equipmentIds = linksResult.data.map((link) => link.equipment_id);
  const equipmentResult = await readInBatches(equipmentIds, (batch) =>
    admin
      .from('installed_equipment')
      .select('id, equipment_number, name, manufacturer, model, location_detail')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (equipmentResult.error) {
    logReadFailure('hydrateListItems: equipment read failed', {
      code: equipmentResult.error.code,
      message: equipmentResult.error.message,
    });
    throw new Error('service_case_equipment_failed');
  }
  const clients = new Map((clientsResult.data ?? []).map((client) => [client.id, client.name]));
  const sites = new Map((sitesResult.data ?? []).map((site) => [site.id, site]));
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const equipment = new Map<string, ServiceCaseEquipment>(
    (equipmentResult.data ?? []).map((item) => [
      item.id,
      {
        id: item.id,
        equipmentNumber: item.equipment_number,
        name: item.name,
        manufacturer: item.manufacturer,
        model: item.model,
        locationDetail: item.location_detail,
      },
    ]),
  );
  const equipmentByCase = new Map<string, ServiceCaseEquipment[]>();
  for (const link of linksResult.data ?? []) {
    const item = equipment.get(link.equipment_id);
    if (!item) continue;
    const values = equipmentByCase.get(link.service_case_id) ?? [];
    values.push(item);
    equipmentByCase.set(link.service_case_id, values);
  }
  return rows.flatMap((row) => {
    const clientName = clients.get(row.client_id);
    const site = sites.get(row.site_id);
    if (!clientName || !site) {
      logError('Service case hydration dropped a row:', site ? 'missing_client' : 'missing_site');
      return [];
    }
    const job = row.job_id ? jobs.get(row.job_id) : null;
    return [
      {
        id: row.id,
        caseNumber: row.case_number,
        intakeType: row.intake_type,
        sourceRequestId: row.source_request_id,
        clientId: row.client_id,
        clientName,
        siteId: row.site_id,
        siteName: site.name,
        siteAddress: formatSiteRowAddress(site),
        summary: row.summary,
        urgency: row.urgency,
        status: row.status,
        chargeContext: row.charge_context,
        jobId: row.job_id,
        jobNumber: job?.job_number ?? null,
        jobTitle: job?.title ?? null,
        equipment: equipmentByCase.get(row.id) ?? [],
        version: row.version,
        updatedAt: row.updated_at,
      },
    ];
  });
}

const serviceCasePageSelectionSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  ids: z.array(uuidSchema).max(LIST_PAGE_SIZE),
});

/**
 * One page of the service-case list. The database applies the status scope,
 * the search and the count before the page boundary; this reader hydrates the
 * page rows only. The page render and the live refresh (background read
 * `service-case-page`) both read through it. Office roles only.
 */
export async function getServiceCasePage(
  rawQuery: ServiceCaseListQuery,
): Promise<ActionResult<{ page: ServiceCasePage }>> {
  const parsedQuery = serviceCaseListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) return { success: false, error: 'invalid_input' };
  const query = parsedQuery.data;
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const selected = await context.admin.rpc('list_service_case_page', {
    p_organization_id: context.organizationId,
    p_status: query.status,
    p_search: query.search,
    p_page: query.page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const selection = serviceCasePageSelectionSchema.safeParse(selected.data);
  if (selected.error || !selection.success) {
    logReadFailure('getServiceCasePage: page selection failed', {
      code: selected.error?.code ?? 'malformed_page',
    });
    return { success: false, error: 'service_case_load_failed' };
  }
  const { data: rows, error } = await readInBatches(selection.data.ids, (batch) =>
    context.admin
      .from('service_cases')
      .select('*')
      .eq('organization_id', context.organizationId)
      .in('id', [...batch]),
  );
  if (error) {
    logReadFailure('getServiceCasePage: page rows read failed', { code: error.code });
    return { success: false, error: 'service_case_load_failed' };
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = selection.data.ids.flatMap((id) => {
    const row = rowById.get(id);
    return row ? [row] : [];
  });
  try {
    const cases = await hydrateListItems(context.admin, context.organizationId, orderedRows);
    return { success: true, page: { cases, total: selection.data.total, hasAnyCase: selection.data.hasAny } };
  } catch (cause) {
    logError('service_case_list_load_failed', cause);
    return { success: false, error: 'service_case_load_failed' };
  }
}
