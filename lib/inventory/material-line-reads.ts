import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type {
  InventoryCategory,
  InventoryItem,
  InventoryLocation,
  InventoryStockLevelRow,
  JobMaterialLine,
  JobMaterialLineRow,
  ProjectMaterialSummary,
} from './types';
import {
  toInventoryCategory,
  toInventoryItem,
  toInventoryLocation,
  toJobMaterialStatus,
  toNumber,
} from './types';

// The material line reads behind the job and project Server Actions in
// `./actions`. The callers authorize the job or project first; every read
// here keeps the organization filter as the tenant boundary.

function readMaterialLineSupportRows(
  admin: AdminClient,
  orgId: string,
  itemIds: string[],
  locationIds: string[],
) {
  return Promise.all([
    readInBatches(itemIds, (batch) =>
      admin
        .from('inventory_items')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('inventory_categories')
          .select('*')
          .eq('organization_id', orgId)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readInBatches(locationIds, (batch) =>
      admin
        .from('inventory_locations')
        .select('*')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(itemIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('inventory_stock_levels')
            .select('*')
            .eq('organization_id', orgId)
            .in('item_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
}

function toJobMaterialLines(
  rows: JobMaterialLineRow[],
  items: InventoryItem[],
  categories: InventoryCategory[],
  locations: InventoryLocation[],
  stockLevels: InventoryStockLevelRow[],
): JobMaterialLine[] {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));

  const stockByItem = new Map<string, number>();
  for (const stock of stockLevels) {
    stockByItem.set(stock.item_id, (stockByItem.get(stock.item_id) ?? 0) + toNumber(stock.quantity_on_hand));
  }

  return rows.flatMap((line): JobMaterialLine[] => {
    const item = itemMap.get(line.item_id);
    if (!item) return [];

    return [
      {
        id: line.id,
        jobId: line.job_id,
        projectId: line.project_id,
        itemId: line.item_id,
        itemName: item.name,
        itemType: item.itemType,
        unit: item.unit,
        categoryName: item.categoryId ? (categoryMap.get(item.categoryId)?.name ?? null) : null,
        preferredLocationId: line.preferred_location_id,
        preferredLocationName: line.preferred_location_id
          ? (locationMap.get(line.preferred_location_id)?.name ?? null)
          : null,
        plannedQuantity: toNumber(line.planned_quantity),
        takenQuantity: toNumber(line.taken_quantity),
        returnedQuantity: toNumber(line.returned_quantity),
        billableQuantity: toNumber(line.billable_quantity),
        isBillable: line.is_billable,
        isUnplanned: line.is_unplanned,
        status: toJobMaterialStatus(line.status),
        notes: line.notes,
        availableQuantity: stockByItem.get(item.id) ?? 0,
      },
    ];
  });
}

/** The display lines of the given material line rows, or `lines_failed` when any lookup read fails. */
export async function hydrateJobMaterialLines(
  admin: AdminClient,
  orgId: string,
  rows: JobMaterialLineRow[],
): Promise<ActionResult<{ lines: JobMaterialLine[] }>> {
  if (rows.length === 0) return { success: true, lines: [] };

  const itemIds = Array.from(new Set(rows.map((line) => line.item_id)));
  const locationIds = Array.from(
    new Set(rows.flatMap((line) => (line.preferred_location_id ? [line.preferred_location_id] : []))),
  );

  const [itemsResult, categoriesResult, locationsResult, stockResult] = await readMaterialLineSupportRows(
    admin,
    orgId,
    itemIds,
    locationIds,
  );
  const hydrationError =
    itemsResult.error ?? categoriesResult.error ?? locationsResult.error ?? stockResult.error;
  if (hydrationError) {
    // A missing item read would drop its lines; never show a partial list.
    logError('Error hydrating job material lines:', hydrationError);
    return { success: false, error: 'lines_failed' };
  }

  const lines = toJobMaterialLines(
    rows,
    itemsResult.data.map(toInventoryItem),
    categoriesResult.data.map(toInventoryCategory),
    locationsResult.data.map(toInventoryLocation),
    stockResult.data,
  );
  return { success: true, lines };
}

type ProjectJob = Pick<Database['public']['Tables']['jobs']['Row'], 'id' | 'job_number' | 'title'>;

function summarizeProjectMaterial(lines: JobMaterialLine[], jobs: ProjectJob[]): ProjectMaterialSummary {
  const directLines = lines.filter((line) => !line.jobId);
  const jobLines = lines.filter((line) => line.jobId);
  const jobMap = new Map(jobs.map((job) => [job.id, job]));
  const jobGroups = jobs
    .map((job) => ({
      jobId: job.id,
      jobNumber: job.job_number,
      jobTitle: job.title ?? 'Auftrag',
      lines: jobLines.filter((line) => line.jobId === job.id),
    }))
    .filter((group) => group.lines.length > 0);

  for (const line of jobLines) {
    if (line.jobId && !jobMap.has(line.jobId)) {
      jobGroups.push({
        jobId: line.jobId,
        jobNumber: null,
        jobTitle: 'Auftrag',
        lines: [line],
      });
    }
  }

  const totalMap = new Map<string, ProjectMaterialSummary['totals'][number]>();
  for (const line of lines) {
    const key = `${line.itemId}:${line.unit}`;
    const current = totalMap.get(key) ?? {
      itemId: line.itemId,
      itemName: line.itemName,
      unit: line.unit,
      plannedQuantity: 0,
      takenQuantity: 0,
      returnedQuantity: 0,
      billableQuantity: 0,
    };
    current.plannedQuantity += line.plannedQuantity;
    current.takenQuantity += line.takenQuantity;
    current.returnedQuantity += line.returnedQuantity;
    current.billableQuantity += line.billableQuantity;
    totalMap.set(key, current);
  }

  return {
    directLines,
    jobGroups,
    totals: Array.from(totalMap.values()).sort((a, b) => a.itemName.localeCompare(b.itemName, 'de')),
  };
}

/** The material of one project: its direct lines, its jobs' lines grouped by job, and the totals per item. */
export async function readProjectMaterialSummary(
  admin: AdminClient,
  orgId: string,
  projectId: string,
): Promise<ActionResult<{ summary: ProjectMaterialSummary }>> {
  const [linesResult, jobsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('job_material_lines')
          .select('*')
          .eq('organization_id', orgId)
          .eq('project_id', projectId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    readCompleteRows(
      (from, to) =>
        admin
          .from('jobs')
          .select('id, job_number, title')
          .eq('organization_id', orgId)
          .eq('project_id', projectId)
          .order('created_at', { ascending: true })
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  ]);

  if (linesResult.error) {
    logError('Error fetching project material lines:', linesResult.error);
    return { success: false, error: 'lines_failed' };
  }
  if (jobsResult.error) {
    logError('Error fetching project jobs for material summary:', jobsResult.error);
    return { success: false, error: 'jobs_failed' };
  }

  const rows = linesResult.data;
  const hydrated = await hydrateJobMaterialLines(admin, orgId, rows);
  if (!hydrated.success) return hydrated;
  return { success: true, summary: summarizeProjectMaterial(hydrated.lines, jobsResult.data) };
}
