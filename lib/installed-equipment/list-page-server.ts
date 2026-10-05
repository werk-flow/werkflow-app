import 'server-only';

import { z } from '@/lib/zod';

import type { ActionResult } from '@/lib/action-result';
import { formatSiteRowAddress } from '@/lib/clients/types';
import { logReadErrors, logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { requireServiceManager, type ServiceAdminClient } from '@/lib/service-cases/manager-context';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { equipmentListQuerySchema, type EquipmentListQuery, type EquipmentPage } from './list-page';
import type { EquipmentIdentifier, EquipmentListItem, EquipmentRow } from './types';

function toIdentifier(
  row: Database['public']['Tables']['installed_equipment_identifiers']['Row'],
): EquipmentIdentifier {
  return {
    id: row.id,
    identifierType: row.identifier_type,
    value: row.value,
    issuer: row.issuer,
  };
}

function toListItem(args: {
  row: EquipmentRow;
  clientName: string;
  site: {
    name: string;
    street: string | null;
    postal_code: string | null;
    city: string | null;
  };
  identifiers: EquipmentIdentifier[];
}): EquipmentListItem {
  return {
    id: args.row.id,
    equipmentNumber: args.row.equipment_number,
    name: args.row.name,
    category: args.row.category,
    subtype: args.row.subtype,
    state: args.row.state,
    manufacturer: args.row.manufacturer,
    model: args.row.model,
    locationDetail: args.row.location_detail,
    clientId: args.row.client_id,
    clientName: args.clientName,
    siteId: args.row.site_id,
    siteName: args.site.name,
    siteAddress: formatSiteRowAddress(args.site) || 'Adresse nicht erfasst',
    parentEquipmentId: args.row.parent_equipment_id,
    archivedAt: args.row.archived_at,
    voidedAt: args.row.voided_at,
    identifiers: args.identifiers,
    version: args.row.version,
  };
}

/**
 * Hydrates equipment rows of one organization into list items: customer,
 * site and identifiers. A failed related read throws instead of returning a
 * shortened list.
 */
export async function loadListItems(
  admin: ServiceAdminClient,
  organizationId: string,
  rows: EquipmentRow[],
): Promise<EquipmentListItem[]> {
  if (rows.length === 0) return [];
  const clientIds = [...new Set(rows.map((row) => row.client_id))];
  const siteIds = [...new Set(rows.map((row) => row.site_id))];
  const equipmentIds = rows.map((row) => row.id);
  const [clientsResult, sitesResult, identifiersResult] = await Promise.all([
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
    // One equipment item sits in exactly one batch, so the per-item
    // `created_at` order survives the concatenation.
    readInBatches(equipmentIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('installed_equipment_identifiers')
            .select('*')
            .eq('organization_id', organizationId)
            .in('equipment_id', [...batch])
            .order('created_at')
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const hydrationError = clientsResult.error ?? sitesResult.error ?? identifiersResult.error;
  if (hydrationError) {
    logReadFailure('loadListItems: equipment hydration read failed', {
      code: hydrationError.code,
      message: hydrationError.message,
    });
    throw new Error('installed_equipment_list_hydration_failed');
  }
  const clientsById = new Map(clientsResult.data.map((client) => [client.id, client.name]));
  const sitesById = new Map(sitesResult.data.map((site) => [site.id, site]));
  const identifiersByEquipment = new Map<string, EquipmentIdentifier[]>();
  for (const row of identifiersResult.data) {
    const identifiers = identifiersByEquipment.get(row.equipment_id) ?? [];
    identifiers.push(toIdentifier(row));
    identifiersByEquipment.set(row.equipment_id, identifiers);
  }
  return rows.flatMap((row) => {
    const site = sitesById.get(row.site_id);
    const clientName = clientsById.get(row.client_id);
    if (!site || !clientName) {
      logError('Installed equipment hydration dropped a row:', site ? 'missing_client' : 'missing_site');
      return [];
    }
    return [
      toListItem({
        row,
        clientName,
        site,
        identifiers: identifiersByEquipment.get(row.id) ?? [],
      }),
    ];
  });
}

const equipmentPageSelectionSchema = z.object({
  total: z.number().int().nonnegative(),
  hasAny: z.boolean(),
  ids: z.array(uuidSchema).max(LIST_PAGE_SIZE),
});

/**
 * One page of the equipment list. The database applies the scope, the search
 * and the count before the page boundary; this reader hydrates the page rows
 * only. The page render and the live refresh (background read
 * `equipment-page`) both read through it. Office roles only.
 */
export async function getInstalledEquipmentPage(
  rawQuery: EquipmentListQuery,
): Promise<ActionResult<{ page: EquipmentPage }>> {
  const parsedQuery = equipmentListQuerySchema.safeParse(rawQuery);
  if (!parsedQuery.success) return { success: false, error: 'installed_equipment_input_invalid' };
  const query = parsedQuery.data;
  const context = await requireServiceManager();
  if ('success' in context) return context;
  const selected = await context.admin.rpc('list_equipment_page', {
    p_organization_id: context.organizationId,
    p_search: query.search,
    p_category: query.category,
    p_include_archived: query.includeArchived,
    p_page: query.page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const selection = equipmentPageSelectionSchema.safeParse(selected.data);
  if (selected.error || !selection.success) {
    logReadFailure('getInstalledEquipmentPage: page selection failed', {
      code: selected.error?.code ?? 'malformed_page',
    });
    return { success: false, error: 'installed_equipment_load_failed' };
  }
  const { data: rows, error } = await readInBatches(selection.data.ids, (batch) =>
    context.admin
      .from('installed_equipment')
      .select('*')
      .eq('organization_id', context.organizationId)
      .in('id', [...batch]),
  );
  if (error) {
    logReadErrors('getInstalledEquipmentPage: page rows read failed', error);
    return { success: false, error: 'installed_equipment_load_failed' };
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = selection.data.ids.flatMap((id) => {
    const row = rowById.get(id);
    return row ? [row] : [];
  });
  try {
    const equipment = await loadListItems(context.admin, context.organizationId, orderedRows);
    return {
      success: true,
      page: { equipment, total: selection.data.total, hasAnyEquipment: selection.data.hasAny },
    };
  } catch {
    return { success: false, error: 'installed_equipment_load_failed' };
  }
}
