import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
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
  MaterialConsumptionLine,
  MaterialUseEvent,
  ProjectMaterialSummary,
} from './types';
import {
  toInventoryCategory,
  toInventoryItem,
  toInventoryLocation,
  toJobMaterialStatus,
  toNumber,
} from './types';
import { materialConsumptionTargetSchema } from './action-schemas';
import { getJobContext, getProjectContext } from './job-project-access';

// The material line reads behind the job and project Server Actions in
// `./actions`. The callers authorize the job or project first; every read
// here keeps the organization filter as the tenant boundary. Only
// `readJobMaterialConsumption`, the reader of other domains, authorizes its
// caller itself.

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
        usedQuantity: toNumber(line.used_quantity),
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
      usedQuantity: 0,
      returnedQuantity: 0,
      billableQuantity: 0,
    };
    current.plannedQuantity += line.plannedQuantity;
    current.takenQuantity += line.takenQuantity;
    current.usedQuantity += line.usedQuantity;
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

type UseEventRow = Database['public']['Tables']['job_material_use_events']['Row'];

function toMaterialUseEvent(row: UseEventRow): MaterialUseEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    projectId: row.project_id,
    lineId: row.job_material_line_id,
    itemId: row.item_id,
    unit: row.unit,
    quantity: toNumber(row.quantity),
    cost:
      row.cost_amount_cents !== null && row.cost_price_quantity !== null
        ? { amountCents: row.cost_amount_cents, priceQuantity: row.cost_price_quantity }
        : null,
    correctsEventId: row.corrects_event_id,
    note: row.note,
    actorId: row.actor_id,
    createdAt: row.created_at,
  };
}

type ConsumptionTarget = { jobId: string } | { projectId: string };

/** The target's lines, a cancelled one only when something was used before, oldest first. */
function readConsumptionLineRows(admin: AdminClient, orgId: string, target: ConsumptionTarget) {
  return readCompleteRows((from, to) => {
    const lines = admin
      .from('job_material_lines')
      .select('*')
      .eq('organization_id', orgId)
      .or('status.neq.cancelled,used_quantity.gt.0');
    return ('jobId' in target ? lines.eq('job_id', target.jobId) : lines.eq('project_id', target.projectId))
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to);
  }, LIST_ROW_CAP);
}

/** The article names and units and every use event of the lines, events oldest first. */
function readConsumptionSupportRows(admin: AdminClient, orgId: string, rows: JobMaterialLineRow[]) {
  return Promise.all([
    readInBatches(
      rows.map((line) => line.item_id),
      (batch) =>
        admin
          .from('inventory_items')
          .select('id, name, unit')
          .eq('organization_id', orgId)
          .in('id', [...batch]),
    ),
    readInBatches(
      rows.map((line) => line.id),
      (batch) =>
        readCompleteRows(
          (from, to) =>
            admin
              .from('job_material_use_events')
              .select('*')
              .eq('organization_id', orgId)
              .in('job_material_line_id', [...batch])
              .order('created_at', { ascending: true })
              .order('id')
              .range(from, to),
          LIST_ROW_CAP,
        ),
    ),
  ]);
}

/** One consumption line per row, or null when a row names an item the read did not return. */
function toConsumptionLines(
  rows: JobMaterialLineRow[],
  items: Array<{ id: string; name: string; unit: string }>,
  eventRows: UseEventRow[],
): MaterialConsumptionLine[] | null {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const eventsByLine = new Map<string, MaterialUseEvent[]>();
  // All events of one line come from one batch, already in their order.
  for (const event of eventRows.map(toMaterialUseEvent)) {
    const lineEvents = eventsByLine.get(event.lineId);
    if (lineEvents) lineEvents.push(event);
    else eventsByLine.set(event.lineId, [event]);
  }
  const lines: MaterialConsumptionLine[] = [];
  for (const line of rows) {
    const item = itemMap.get(line.item_id);
    if (!item) return null;
    lines.push({
      lineId: line.id,
      jobId: line.job_id,
      projectId: line.project_id,
      itemId: line.item_id,
      itemName: item.name,
      unit: item.unit,
      plannedQuantity: toNumber(line.planned_quantity),
      takenQuantity: toNumber(line.taken_quantity),
      usedQuantity: toNumber(line.used_quantity),
      returnedQuantity: toNumber(line.returned_quantity),
      isUnplanned: line.is_unplanned,
      events: eventsByLine.get(line.id) ?? [],
    });
  }
  return lines;
}

/**
 * The consumption facts of a job's or a project's material for the office's
 * billable review: per line the planned, taken, used and returned quantities
 * and every use event with its cost snapshot, corrections included, oldest
 * first. A project covers its own lines and those of its jobs. Admin and Büro
 * only, because the events carry purchase costs. It decides no billability.
 * The billable review of werk-flow/werkflow-planning#16 is its first caller;
 * until it lands, only the boundary test calls it.
 * @internal
 */
export async function readJobMaterialConsumption(
  rawTarget: ConsumptionTarget,
): Promise<ActionResult<{ lines: MaterialConsumptionLine[] }>> {
  const parsedTarget = materialConsumptionTargetSchema.safeParse(rawTarget);
  if (!parsedTarget.success) return { success: false, error: 'invalid_input' };
  const target = parsedTarget.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };
  const { context } = auth;
  if (!context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

  const admin = createSupabaseAdminClient();
  const access =
    'jobId' in target
      ? await getJobContext(context, target.jobId)
      : await getProjectContext(admin, context, target.projectId);
  if (!access.success) return access;

  const linesResult = await readConsumptionLineRows(admin, context.orgId, target);
  if (linesResult.error) {
    logError('readJobMaterialConsumption: job_material_lines read failed', linesResult.error);
    return { success: false, error: 'lines_failed' };
  }
  if (linesResult.data.length === 0) return { success: true, lines: [] };

  const [itemsResult, eventsResult] = await readConsumptionSupportRows(
    admin,
    context.orgId,
    linesResult.data,
  );
  const readError = itemsResult.error ?? eventsResult.error;
  if (readError) {
    logError('readJobMaterialConsumption: item or use event read failed', readError);
    return { success: false, error: 'lines_failed' };
  }
  const lines = toConsumptionLines(linesResult.data, itemsResult.data, eventsResult.data);
  // A line always names an item of its organization; never answer with a partial list.
  if (!lines) {
    logError('readJobMaterialConsumption: a line names a missing item');
    return { success: false, error: 'lines_failed' };
  }
  return { success: true, lines };
}
