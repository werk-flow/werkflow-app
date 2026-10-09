'use server';

import { revalidatePath } from 'next/cache';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { inventoryPageQuerySchema, inventoryPageResultSchema } from './list-page';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { loggedRead, logReadErrors } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { AuthContext } from '@/lib/jobs/auth';
import type {
  InventoryCategoryRow,
  InventoryItem,
  InventoryItemRow,
  InventoryItemType,
  InventoryLocation,
  InventoryLocationRow,
  InventoryLocationType,
  InventoryMovementRow,
  InventoryOverview,
  InventoryPickerOption,
  ProjectMaterialSummary,
  InventoryStockLevelRow,
  JobMaterialLine,
  JobMaterialLineRow,
} from './types';
import {
  INVENTORY_PICKER_PAGE_SIZE,
  toInventoryCategory,
  toInventoryItem,
  toInventoryLocation,
  toNumber,
} from './types';
import {
  asRows,
  loadActiveInventoryLocations,
  loadInventoryOverviewLists,
  loadInventoryPickerOptions,
} from './catalog-reads';
import type { SupabaseAdminClient } from './catalog-reads';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  adjustInventoryStockSchema,
  createInventoryLocationSchema,
  createJobMaterialLineSchema,
  createProjectMaterialLineSchema,
  importInventoryRowsSchema,
  optionalItemIdSchema,
  pickerSearchSchema,
  returnJobMaterialSchema,
  takeJobMaterialSchema,
  takeProjectMaterialSchema,
  updateJobMaterialLineSchema,
  upsertInventoryItemSchema,
} from './action-schemas';

export type CreateInventoryLocationInput = {
  name: string;
  description?: string | null;
  locationType?: InventoryLocationType;
  parentLocationId?: string | null;
};

export type UpsertInventoryItemInput = {
  id?: string;
  name: string;
  itemType: InventoryItemType;
  description?: string | null;
  categoryId?: string | null;
  unit: string;
  internalSku?: string | null;
  manufacturer?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierArticleNumber?: string | null;
  purchasePriceCents?: number | null;
  salePriceCents?: number | null;
  isBillable: boolean;
  globalMinimumStock?: number;
  globalTargetStock?: number | null;
  trackQuantity?: boolean;
  trackIndividualAssets?: boolean;
  barcode?: string | null;
  notes?: string | null;
  initialLocationId?: string | null;
  initialQuantity?: number | null;
};

export type AdjustInventoryStockInput = {
  itemId: string;
  locationId: string;
  direction?: 'add' | 'remove';
  quantityDelta?: number;
  quantity?: number;
  reason?: string | null;
};

export type CreateJobMaterialLineInput = {
  jobId: string;
  itemId: string;
  preferredLocationId?: string | null;
  plannedQuantity: number;
  notes?: string | null;
};

export type CreateProjectMaterialLineInput = {
  projectId: string;
  itemId: string;
  preferredLocationId?: string | null;
  plannedQuantity: number;
  notes?: string | null;
};

export type UpdateJobMaterialLineInput = {
  lineId: string;
  itemId?: string;
  preferredLocationId?: string | null;
  plannedQuantity?: number;
  isBillable?: boolean;
  notes?: string | null;
};

export type TakeJobMaterialInput = {
  jobId: string;
  lineId?: string | null;
  itemId?: string | null;
  locationId: string;
  quantity: number;
  reason?: string | null;
};

export type ReturnJobMaterialInput = {
  lineId: string;
  locationId: string;
  quantity: number;
  reason?: string | null;
};

export type InventoryImportRow = {
  name: string;
  itemType?: InventoryItemType;
  categoryName?: string | null;
  locationName?: string | null;
  unit?: string | null;
  quantity?: number | null;
  minimumStock?: number | null;
  targetStock?: number | null;
  internalSku?: string | null;
  barcode?: string | null;
  manufacturer?: string | null;
  supplierName?: string | null;
  supplierArticleNumber?: string | null;
  purchasePriceCents?: number | null;
  salePriceCents?: number | null;
  isBillable?: boolean | null;
  notes?: string | null;
};

export type ImportInventoryRowsInput = {
  fileName: string;
  columnMapping: Record<string, string>;
  rows: InventoryImportRow[];
};

async function getAuthContext(): Promise<ActionResult<{ context: AuthContext }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };

  return { success: true, context: auth.context };
}

async function requireInventoryManager(): Promise<ActionResult<{ context: AuthContext }>> {
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return auth;
}

function asRow<T>(data: unknown): T | null {
  return data ? (data as T) : null;
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

// Quantities are `numeric(12,3)`: rounding to two digits turned a booked
// 0,125 m into 0,13 and refused its return as more than was taken.
function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 1000) / 1000);
}

function normalizePrice(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeInventoryUnitInput(value: string | null | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/ü/g, 'ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe');

  if (!normalized) return 'piece';

  const aliases: Record<string, string> = {
    stueck: 'piece',
    stuck: 'piece',
    stk: 'piece',
    st: 'piece',
    piece: 'piece',
    pieces: 'piece',
    meter: 'meter',
    m: 'meter',
    rolle: 'roll',
    roll: 'roll',
    packung: 'package',
    paket: 'package',
    package: 'package',
    karton: 'box',
    box: 'box',
    set: 'set',
    paar: 'pair',
    pair: 'pair',
    liter: 'liter',
    l: 'liter',
    kilogramm: 'kilogram',
    kilogram: 'kilogram',
    kg: 'kilogram',
    sack: 'sack',
    kartusche: 'cartridge',
    cartridge: 'cartridge',
    bund: 'bundle',
    bundle: 'bundle',
    palette: 'pallet',
    pallet: 'pallet',
  };

  return aliases[normalized] ?? value?.trim() ?? 'piece';
}

function invalidateInventory() {
  revalidatePath('/inventar');
}

async function ensureInventoryDefaults(admin: SupabaseAdminClient, context: AuthContext): Promise<void> {
  const { error } = await admin.rpc('ensure_inventory_defaults', {
    p_org_id: context.orgId,
    p_actor_id: context.userId,
  });

  if (error) {
    logError('Error ensuring inventory defaults:', error);
  }
}

async function getJobContext(
  admin: SupabaseAdminClient,
  context: AuthContext,
  jobId: string,
): Promise<ActionResult<{ job: { id: string; project_id: string | null } }>> {
  const { data, error } = await loggedRead(
    'getJobContext: jobs read failed',
    admin
      .from('jobs')
      .select('id, project_id')
      .eq('id', jobId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );

  const job = asRow<{ id: string; project_id: string | null }>(data);
  if (error) return { success: false, error: 'load_failed' };
  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (!context.isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await loggedRead(
      'getJobContext: job_assignments read failed',
      admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', context.orgId)
        .eq('job_id', jobId)
        .eq('user_id', context.userId)
        .maybeSingle(),
    );
    if (assignmentError) return { success: false, error: 'load_failed' };

    if (!assignment) {
      return { success: false, error: 'not_authorized' };
    }
  }

  return { success: true, job };
}

async function getProjectContext(
  admin: SupabaseAdminClient,
  context: AuthContext,
  projectId: string,
): Promise<ActionResult<{ project: { id: string } }>> {
  const { data, error } = await loggedRead(
    'getProjectContext: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );

  const project = asRow<{ id: string }>(data);
  if (error) return { success: false, error: 'load_failed' };
  if (!project) {
    return { success: false, error: 'project_not_found' };
  }

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  return { success: true, project };
}

// The refusals of save_inventory_item, import_inventory_row (migration
// 20261004151000) and take_unplanned_inventory_material (20261004151100) that
// the action passes on as its failure code.
const INVENTORY_WRITE_REFUSALS = new Set([
  'not_authorized',
  'invalid_input',
  'location_required_for_initial_stock',
  'item_not_found',
  'category_not_found',
  'supplier_not_found',
  'location_not_found',
  'barcode_taken',
  'batch_not_found',
  'job_not_found',
  'project_not_found',
]);

function inventoryWriteFailure(
  label: string,
  error: { code?: string; message?: string },
  fallback: 'save_failed' | 'movement_failed',
): ActionFailure {
  const message = error.message ?? '';
  if (INVENTORY_WRITE_REFUSALS.has(message)) return { success: false, error: message };
  logError(label, error);
  if (message.includes('inventory stock cannot go below zero')) {
    return { success: false, error: 'stock_would_go_negative' };
  }
  if (message.includes('not available for stock movement'))
    return { success: false, error: 'movement_failed' };
  return { success: false, error: fallback };
}

async function recordMovement(
  admin: SupabaseAdminClient,
  context: AuthContext,
  input: {
    itemId: string;
    locationId: string;
    movementType: string;
    quantityDelta: number;
    jobId?: string | null;
    projectId?: string | null;
    jobMaterialLineId?: string | null;
    reason?: string | null;
  },
): Promise<ActionResult<{ quantityAfter: number }>> {
  const { data, error } = await admin.rpc(
    'record_inventory_movement',
    rpcArgs('record_inventory_movement', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_item_id: input.itemId,
      p_location_id: input.locationId,
      p_movement_type: input.movementType,
      p_quantity_delta: input.quantityDelta,
      p_job_id: input.jobId ?? null,
      p_project_id: input.projectId ?? null,
      p_job_material_line_id: input.jobMaterialLineId ?? null,
      p_import_batch_id: null,
      p_reason: cleanText(input.reason),
    }),
  );

  if (error) {
    logError('Error recording inventory movement.', {
      code: error.code ?? 'unknown',
    });
    if (error.message?.includes('inventory stock cannot go below zero')) {
      return { success: false, error: 'stock_would_go_negative' };
    }
    if (error.message?.includes('not a member')) {
      return { success: false, error: 'not_authorized' };
    }
    return { success: false, error: 'movement_failed' };
  }

  // The function returns one row per recorded movement.
  const [movement] = data ?? [];
  if (!movement) {
    logError('Error recording inventory movement: no movement row returned.');
    return { success: false, error: 'movement_failed' };
  }
  return { success: true, quantityAfter: toNumber(movement.quantity_after) };
}

// A take without a planned line: the unplanned line and the take commit
// together, so a refused take leaves no empty line behind.
async function takeUnplannedMaterial(
  admin: SupabaseAdminClient,
  context: AuthContext,
  input: {
    jobId: string | null;
    projectId: string | null;
    itemId: string;
    locationId: string;
    quantity: number;
    reason: string | null | undefined;
    defaultReason: string;
  },
): Promise<ActionResult<{ quantityAfter: number }>> {
  const { data, error } = await admin.rpc(
    'take_unplanned_inventory_material',
    rpcArgs('take_unplanned_inventory_material', {
      p_organization_id: context.orgId,
      p_actor_id: context.userId,
      p_job_id: input.jobId,
      p_project_id: input.projectId,
      p_item_id: input.itemId,
      p_location_id: input.locationId,
      p_quantity: input.quantity,
      p_reason: cleanText(input.reason) ?? input.defaultReason,
      p_notes: cleanText(input.reason),
    }),
  );
  if (error) {
    return inventoryWriteFailure(
      'takeUnplannedMaterial: take_unplanned_inventory_material failed',
      error,
      'movement_failed',
    );
  }
  return { success: true, quantityAfter: toNumber(data) };
}

type InventoryOrganizationReferenceTable = 'inventory_categories' | 'inventory_locations';

async function resolveInventoryOrganizationReference(
  admin: SupabaseAdminClient,
  table: InventoryOrganizationReferenceTable,
  organizationId: string,
  inputId: string | null | undefined,
  missingError: 'category_not_found' | 'location_not_found',
): Promise<ActionResult<{ referenceId: string | null }>> {
  const referenceId = cleanText(inputId);
  if (!referenceId) return { success: true, referenceId: null };

  const { data, error } = await admin
    .from(table)
    .select('id')
    .eq('id', referenceId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    logError('Error resolving inventory organization reference.', {
      code: error.code ?? 'unknown',
      table,
    });
    return { success: false, error: 'reference_lookup_failed' };
  }

  const resolvedReference = asRow<{ id: string }>(data);
  if (!resolvedReference) return { success: false, error: missingError };

  return { success: true, referenceId: resolvedReference.id };
}

export async function getInventoryOverview(
  input: unknown = {},
): Promise<ActionResult<{ overview: InventoryOverview }>> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;
  const parsedQuery = inventoryPageQuerySchema.safeParse(input);
  if (!parsedQuery.success) return { success: false, error: 'inventory_failed' };
  const query = parsedQuery.data;
  const admin = createSupabaseAdminClient();
  const { orgId } = auth.context;
  await ensureInventoryDefaults(admin, auth.context);
  const [pageResult, movementsResult] = await Promise.all([
    admin.rpc('list_inventory_page', { p_organization_id: orgId, p_query: query }),
    admin
      .from('inventory_movements')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(40),
  ]);
  if (pageResult.error || movementsResult.error) {
    logReadErrors('getInventoryOverview: read failed', pageResult.error, movementsResult.error);
    return { success: false, error: 'inventory_failed' };
  }
  const parsedPage = inventoryPageResultSchema.safeParse(pageResult.data);
  if (!parsedPage.success) return { success: false, error: 'inventory_failed' };
  const page = parsedPage.data;
  const movements = asRows<InventoryMovementRow>(movementsResult.data);
  const lists = await loadInventoryOverviewLists(admin, orgId, page, movements);
  if (!lists.success) return lists;

  const summary = page.summary;

  return {
    success: true,
    overview: {
      categories: lists.categories,
      locations: lists.locations,
      suppliers: lists.suppliers,
      items: lists.items,
      movements: lists.movements,
      summary,
      page: {
        query,
        ids: page.ids,
        total: page.total,
        locationIds: page.locationIds,
        locationCounts: page.locationCounts,
      },
    },
  };
}

/**
 * The active storage locations for the work-template editor. A company holds
 * a handful of locations, so they come complete; the material picker searches
 * the catalog on the server (`'entity-options'`, kind `inventory-items`).
 */
export async function getInventoryLocationOptions(): Promise<
  ActionResult<{ locations: InventoryLocation[] }>
> {
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  await ensureInventoryDefaults(admin, auth.context);
  return loadActiveInventoryLocations(admin, auth.context.orgId);
}

/**
 * The office picker on a job or project: one page of the catalog, the matches
 * of a search, or the one item an existing line refers to. The page never
 * carries the whole organization.
 */
export async function getInventoryPickerPage(
  searchTermInput = '',
  exactItemIdInput?: string,
): Promise<ActionResult<{ items: InventoryPickerOption[]; locations: InventoryLocation[] }>> {
  const parsedExactItemId = optionalItemIdSchema.safeParse(exactItemIdInput);
  if (!parsedExactItemId.success) return { success: false, error: 'invalid_input' };
  const exactItemId = parsedExactItemId.data;
  const parsedSearchTerm = pickerSearchSchema.safeParse(searchTermInput);
  if (!parsedSearchTerm.success) return { success: false, error: 'invalid_input' };
  const searchTerm = parsedSearchTerm.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  // The first page of a job or project sets up the defaults; a search only reads.
  if (!searchTerm && !exactItemId) await ensureInventoryDefaults(admin, auth.context);
  return loadInventoryPickerOptions(admin, auth.context.orgId, true, {
    searchTerm,
    itemLimit: INVENTORY_PICKER_PAGE_SIZE,
    exactItemId,
  });
}

/**
 * Loads the existing catalog only after an assigned worker starts a material
 * action. Unlike the office picker, reading an assigned job never creates
 * inventory defaults and never exposes supplier or billability details.
 */
export async function getInventoryPickerOptionsForJob(
  jobIdInput: string,
  searchTermInput = '',
  exactItemIdInput?: string,
): Promise<ActionResult<{ items: InventoryPickerOption[]; locations: InventoryLocation[] }>> {
  const parsedExactItemId = optionalItemIdSchema.safeParse(exactItemIdInput);
  if (!parsedExactItemId.success) return { success: false, error: 'invalid_input' };
  const exactItemId = parsedExactItemId.data;
  const parsedSearchTerm = pickerSearchSchema.safeParse(searchTermInput);
  if (!parsedSearchTerm.success) return { success: false, error: 'invalid_input' };
  const searchTerm = parsedSearchTerm.data;
  const parsedJobId = uuidSchema.safeParse(jobIdInput);
  if (!parsedJobId.success) return { success: false, error: 'invalid_input' };
  const jobId = parsedJobId.data;
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, jobId);
  if (!jobContext.success) return jobContext;

  return loadInventoryPickerOptions(admin, auth.context.orgId, auth.context.isManagerOrAbove, {
    searchTerm,
    itemLimit: INVENTORY_PICKER_PAGE_SIZE,
    exactItemId,
  });
}

export async function createInventoryLocation(
  rawInput: CreateInventoryLocationInput,
): Promise<ActionResult<{ location: InventoryLocation }>> {
  const parsedInput = createInventoryLocationSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const name = cleanText(input.name);
  if (!name) return { success: false, error: 'name_required' };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('inventory_locations')
    .insert({
      organization_id: auth.context.orgId,
      parent_location_id: input.parentLocationId ?? null,
      name,
      description: cleanText(input.description),
      location_type: input.locationType ?? 'room',
      created_by: auth.context.userId,
    })
    .select()
    .single();

  if (error || !data) {
    logError('Error creating inventory location:', error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory();
  return { success: true, location: toInventoryLocation(data as InventoryLocationRow) };
}

export async function upsertInventoryItem(
  rawInput: UpsertInventoryItemInput,
): Promise<ActionResult<{ item: InventoryItem }>> {
  const parsedInput = upsertInventoryItemSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const name = cleanText(input.name);
  if (!name) return { success: false, error: 'name_required' };
  if (!input.unit.trim()) return { success: false, error: 'unit_required' };

  const initialQuantity = normalizeQuantity(input.initialQuantity ?? 0);
  const requestedInitialLocationId = input.id ? null : (input.initialLocationId ?? null);
  if (initialQuantity > 0 && !requestedInitialLocationId) {
    return { success: false, error: 'location_required_for_initial_stock' };
  }

  const admin = createSupabaseAdminClient();
  const item = {
    item_type: input.itemType,
    name,
    description: cleanText(input.description),
    category_id: cleanText(input.categoryId),
    unit: normalizeInventoryUnitInput(input.unit),
    internal_sku: cleanText(input.internalSku),
    manufacturer: cleanText(input.manufacturer),
    supplier_id: cleanText(input.supplierId),
    supplier_article_number: cleanText(input.supplierArticleNumber),
    purchase_price_cents: normalizePrice(input.purchasePriceCents),
    sale_price_cents: normalizePrice(input.salePriceCents),
    is_billable: input.isBillable,
    global_minimum_stock: normalizeQuantity(input.globalMinimumStock ?? 0),
    global_target_stock:
      input.globalTargetStock === null || input.globalTargetStock === undefined
        ? null
        : normalizeQuantity(input.globalTargetStock),
    track_quantity: input.trackQuantity ?? true,
    track_individual_assets: input.trackIndividualAssets ?? ['asset', 'tool'].includes(input.itemType),
    notes: cleanText(input.notes),
  };

  // The item, its primary barcode and its first count commit together or not at all.
  const { data, error } = await admin.rpc(
    'save_inventory_item',
    rpcArgs('save_inventory_item', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_item_id: input.id ?? null,
      p_item: item,
      p_supplier_name: cleanText(input.supplierName),
      p_barcode: cleanText(input.barcode),
      p_initial_location_id: requestedInitialLocationId,
      p_initial_quantity: input.id ? 0 : initialQuantity,
    }),
  );
  if (error) {
    return inventoryWriteFailure('upsertInventoryItem: save_inventory_item failed', error, 'save_failed');
  }

  invalidateInventory();
  return { success: true, item: toInventoryItem(data as InventoryItemRow) };
}

export async function adjustInventoryStock(
  rawInput: AdjustInventoryStockInput,
): Promise<ActionResult<{ quantityAfter: number }>> {
  const parsedInput = adjustInventoryStockSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const explicitDelta =
    input.quantityDelta !== undefined && Number.isFinite(input.quantityDelta) ? input.quantityDelta : null;
  const positiveQuantity = normalizeQuantity(input.quantity ?? 0);
  const quantityDelta =
    explicitDelta !== null
      ? explicitDelta
      : input.direction === 'remove'
        ? -positiveQuantity
        : positiveQuantity;

  if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
    return { success: false, error: 'quantity_required' };
  }
  if (!input.locationId) return { success: false, error: 'location_required' };

  const admin = createSupabaseAdminClient();
  const result = await recordMovement(admin, auth.context, {
    itemId: input.itemId,
    locationId: input.locationId,
    movementType: quantityDelta > 0 ? 'stock_in' : 'stock_out',
    quantityDelta,
    reason: input.reason || 'Manuelle Bestandsänderung',
  });

  if (!result.success) return result;

  invalidateInventory();
  return result;
}

// The shared write of a planned material line for a job or a project whose
// access the calling action has already checked.
async function insertMaterialLine(
  admin: SupabaseAdminClient,
  context: AuthContext,
  {
    owner,
    input,
    readLabel,
    failureLabel,
  }: {
    owner: { job_id: string | null; project_id: string | null };
    input: {
      itemId: string;
      preferredLocationId?: string | null | undefined;
      plannedQuantity: number;
      notes?: string | null | undefined;
    };
    readLabel: string;
    failureLabel: string;
  },
): Promise<ActionResult<{ lineId: string }>> {
  const plannedQuantity = normalizeQuantity(input.plannedQuantity);
  if (plannedQuantity <= 0) return { success: false, error: 'quantity_required' };

  const { data: itemRow, error: itemRowError } = await loggedRead(
    readLabel,
    admin
      .from('inventory_items')
      .select('*')
      .eq('id', input.itemId)
      .eq('organization_id', context.orgId)
      .maybeSingle(),
  );
  if (itemRowError) return { success: false, error: 'load_failed' };

  const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
  if (!item) return { success: false, error: 'item_not_found' };

  const locationReference = await resolveInventoryOrganizationReference(
    admin,
    'inventory_locations',
    context.orgId,
    input.preferredLocationId,
    'location_not_found',
  );
  if (!locationReference.success) return locationReference;

  const { data, error } = await admin
    .from('job_material_lines')
    .insert({
      organization_id: context.orgId,
      ...owner,
      item_id: item.id,
      preferred_location_id: locationReference.referenceId,
      planned_quantity: plannedQuantity,
      is_billable: item.isBillable,
      notes: cleanText(input.notes),
      created_by: context.userId,
    })
    .select()
    .single();

  if (error || !data) {
    logError(failureLabel, error);
    return { success: false, error: 'create_failed' };
  }

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');

  // The write already committed. Refreshing labels/stock belongs to the reader;
  // a failed read must never tell the caller to repeat this mutation.
  return { success: true, lineId: data.id };
}

export async function createJobMaterialLine(
  rawInput: CreateJobMaterialLineInput,
): Promise<ActionResult<{ lineId: string }>> {
  const parsedInput = createJobMaterialLineSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, input.jobId);
  if (!jobContext.success) return jobContext;

  return insertMaterialLine(admin, auth.context, {
    owner: { job_id: jobContext.job.id, project_id: jobContext.job.project_id },
    input,
    readLabel: 'createJobMaterialLine: inventory_items read failed',
    failureLabel: 'Error creating job material line:',
  });
}

export async function createProjectMaterialLine(
  rawInput: CreateProjectMaterialLineInput,
): Promise<ActionResult<{ lineId: string }>> {
  const parsedInput = createProjectMaterialLineSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const projectContext = await getProjectContext(admin, auth.context, input.projectId);
  if (!projectContext.success) return projectContext;

  return insertMaterialLine(admin, auth.context, {
    owner: { job_id: null, project_id: projectContext.project.id },
    input,
    readLabel: 'createProjectMaterialLine: inventory_items read failed',
    failureLabel: 'Error creating project material line:',
  });
}

export async function updateJobMaterialLine(
  rawInput: UpdateJobMaterialLineInput,
): Promise<ActionResult<{ lineId: string }>> {
  const parsedInput = updateJobMaterialLineSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await loggedRead(
    'updateJobMaterialLine: job_material_lines read failed',
    admin
      .from('job_material_lines')
      .select('*')
      .eq('id', input.lineId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (existingError) return { success: false, error: 'load_failed' };

  if (!existing) return { success: false, error: 'line_not_found' };

  const updateData: Record<string, unknown> = {};
  if (input.itemId !== undefined && input.itemId !== existing.item_id) {
    const existingLine = existing as JobMaterialLineRow;
    const hasMovement =
      toNumber(existingLine.taken_quantity) > 0 || toNumber(existingLine.returned_quantity) > 0;

    if (hasMovement) {
      return { success: false, error: 'line_has_movements' };
    }

    const { data: itemRow, error: itemRowError } = await loggedRead(
      'updateJobMaterialLine: inventory_items read failed',
      admin
        .from('inventory_items')
        .select('*')
        .eq('id', input.itemId)
        .eq('organization_id', auth.context.orgId)
        .maybeSingle(),
    );
    if (itemRowError) return { success: false, error: 'load_failed' };

    const item = itemRow ? toInventoryItem(itemRow as InventoryItemRow) : null;
    if (!item) return { success: false, error: 'item_not_found' };

    updateData.item_id = item.id;
    updateData.is_billable = item.isBillable;
  }
  if (input.preferredLocationId !== undefined) {
    const locationReference = await resolveInventoryOrganizationReference(
      admin,
      'inventory_locations',
      auth.context.orgId,
      input.preferredLocationId,
      'location_not_found',
    );
    if (!locationReference.success) return locationReference;
    updateData.preferred_location_id = locationReference.referenceId;
  }
  if (input.plannedQuantity !== undefined) {
    updateData.planned_quantity = normalizeQuantity(input.plannedQuantity);
  }
  if (input.isBillable !== undefined) {
    updateData.is_billable = input.isBillable;
  }
  if (input.notes !== undefined) {
    updateData.notes = cleanText(input.notes);
  }

  if (Object.keys(updateData).length === 0) {
    return { success: false, error: 'no_changes' };
  }

  const lineUpdate = admin
    .from('job_material_lines')
    .update(updateData)
    .eq('id', input.lineId)
    .eq('organization_id', auth.context.orgId);
  // A new item needs a line without movements; the filters refuse a movement booked after the check.
  const itemChanges = updateData.item_id !== undefined;
  const { data, error } = await (
    itemChanges ? lineUpdate.eq('taken_quantity', 0).eq('returned_quantity', 0) : lineUpdate
  )
    .select('id')
    .maybeSingle();

  if (error) {
    logError('Error updating job material line:', error);
    return { success: false, error: 'update_failed' };
  }
  if (!data) return { success: false, error: itemChanges ? 'line_has_movements' : 'line_not_found' };

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');

  // The write already committed. Refreshing labels/stock belongs to the reader;
  // a failed read must never tell the caller to repeat this mutation.
  return { success: true, lineId: data.id };
}

export async function deleteJobMaterialLine(lineIdInput: string): Promise<ActionResult> {
  const parsedLineId = uuidSchema.safeParse(lineIdInput);
  if (!parsedLineId.success) return { success: false, error: 'invalid_input' };
  const lineId = parsedLineId.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await loggedRead(
    'deleteJobMaterialLine: job_material_lines read failed',
    admin
      .from('job_material_lines')
      .select('*')
      .eq('id', lineId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (existingError) return { success: false, error: 'load_failed' };

  const line = asRow<JobMaterialLineRow>(existing);
  if (!line) return { success: false, error: 'line_not_found' };

  // A line with movements is cancelled so its ledger keeps the line; one without
  // is deleted. The quantity filters refuse a movement booked after the check.
  const hasMovement = toNumber(line.taken_quantity) > 0 || toNumber(line.returned_quantity) > 0;
  const result = hasMovement
    ? await admin
        .from('job_material_lines')
        .update({ status: 'cancelled' })
        .eq('id', lineId)
        .eq('organization_id', auth.context.orgId)
        .or('taken_quantity.gt.0,returned_quantity.gt.0')
        .select('id')
    : await admin
        .from('job_material_lines')
        .delete()
        .eq('id', lineId)
        .eq('organization_id', auth.context.orgId)
        .eq('taken_quantity', 0)
        .eq('returned_quantity', 0)
        .select('id');

  if (result.error) {
    logError('Error deleting job material line:', result.error);
    return { success: false, error: 'delete_failed' };
  }
  if (result.data.length !== 1) return { success: false, error: 'line_changed' };

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');
  return { success: true };
}

export async function getJobMaterialLines(
  jobIdInput: string,
): Promise<ActionResult<{ lines: JobMaterialLine[] }>> {
  const parsedJobId = uuidSchema.safeParse(jobIdInput);
  if (!parsedJobId.success) return { success: false, error: 'invalid_input' };
  const jobId = parsedJobId.data;
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, jobId);
  if (!jobContext.success) return jobContext;

  const { data, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('job_material_lines')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .eq('job_id', jobId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );

  if (error) {
    logError('Error fetching job material lines:', error);
    return { success: false, error: 'lines_failed' };
  }

  const hydrated = await hydrateJobMaterialLines(admin, auth.context.orgId, asRows<JobMaterialLineRow>(data));
  if (!hydrated.success) return hydrated;
  const { lines } = hydrated;

  return {
    success: true,
    lines: auth.context.isManagerOrAbove
      ? lines
      : lines.map((line) => ({ ...line, billableQuantity: 0, isBillable: false })),
  };
}

export async function getProjectMaterialSummary(
  projectIdInput: string,
): Promise<ActionResult<{ summary: ProjectMaterialSummary }>> {
  const parsedProjectId = uuidSchema.safeParse(projectIdInput);
  if (!parsedProjectId.success) return { success: false, error: 'invalid_input' };
  const projectId = parsedProjectId.data;
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const projectContext = await getProjectContext(admin, auth.context, projectId);
  if (!projectContext.success) return projectContext;

  const [linesResult, jobsResult] = await Promise.all([
    readCompleteRows(
      (from, to) =>
        admin
          .from('job_material_lines')
          .select('*')
          .eq('organization_id', auth.context.orgId)
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
          .eq('organization_id', auth.context.orgId)
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

  const rows = asRows<JobMaterialLineRow>(linesResult.data);
  const hydrated = await hydrateJobMaterialLines(admin, auth.context.orgId, rows);
  if (!hydrated.success) return hydrated;
  const { lines } = hydrated;
  const directLines = lines.filter((line) => !line.jobId);
  const jobLines = lines.filter((line) => line.jobId);
  const jobs = asRows<{ id: string; job_number: string | null; title: string | null }>(jobsResult.data);
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
    success: true,
    summary: {
      directLines,
      jobGroups,
      totals: Array.from(totalMap.values()).sort((a, b) => a.itemName.localeCompare(b.itemName, 'de')),
    },
  };
}

async function hydrateJobMaterialLines(
  admin: SupabaseAdminClient,
  orgId: string,
  rows: JobMaterialLineRow[],
): Promise<ActionResult<{ lines: JobMaterialLine[] }>> {
  if (rows.length === 0) return { success: true, lines: [] };

  const itemIds = Array.from(new Set(rows.map((line) => line.item_id)));
  const locationIds = Array.from(
    new Set(rows.map((line) => line.preferred_location_id).filter(Boolean)),
  ) as string[];

  const [itemsResult, categoriesResult, locationsResult, stockResult] = await Promise.all([
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
  const hydrationError =
    itemsResult.error ?? categoriesResult.error ?? locationsResult.error ?? stockResult.error;
  if (hydrationError) {
    // A missing item read would drop its lines; never show a partial list.
    logError('Error hydrating job material lines:', hydrationError);
    return { success: false, error: 'lines_failed' };
  }

  const items = asRows<InventoryItemRow>(itemsResult.data).map(toInventoryItem);
  const categories = asRows<InventoryCategoryRow>(categoriesResult.data).map(toInventoryCategory);
  const locations = asRows<InventoryLocationRow>(locationsResult.data).map(toInventoryLocation);
  const stockLevels = asRows<InventoryStockLevelRow>(stockResult.data);
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const locationMap = new Map(locations.map((location) => [location.id, location]));

  const stockByItem = new Map<string, number>();
  for (const stock of stockLevels) {
    stockByItem.set(stock.item_id, (stockByItem.get(stock.item_id) ?? 0) + toNumber(stock.quantity_on_hand));
  }

  const lines = rows.flatMap((line): JobMaterialLine[] => {
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
        status: line.status,
        notes: line.notes,
        availableQuantity: stockByItem.get(item.id) ?? 0,
      },
    ];
  });
  return { success: true, lines };
}

export async function takeJobMaterial(
  rawInput: TakeJobMaterialInput,
): Promise<ActionResult<{ quantityAfter: number }>> {
  const parsedInput = takeJobMaterialSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };
  if (!input.locationId) return { success: false, error: 'location_required' };

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(admin, auth.context, input.jobId);
  if (!jobContext.success) return jobContext;

  let result: ActionResult<{ quantityAfter: number }>;
  if (input.lineId) {
    const { data: line, error: lineError } = await loggedRead(
      'takeJobMaterial: job_material_lines read failed',
      admin
        .from('job_material_lines')
        .select('*')
        .eq('id', input.lineId)
        .eq('organization_id', auth.context.orgId)
        .eq('job_id', input.jobId)
        .maybeSingle(),
    );
    if (lineError) return { success: false, error: 'load_failed' };
    const existingLine = asRow<JobMaterialLineRow>(line);
    if (!existingLine) return { success: false, error: 'line_not_found' };
    result = await recordMovement(admin, auth.context, {
      itemId: existingLine.item_id,
      locationId: input.locationId,
      movementType: 'job_take',
      quantityDelta: -quantity,
      jobId: jobContext.job.id,
      projectId: jobContext.job.project_id,
      jobMaterialLineId: existingLine.id,
      reason: input.reason || 'Für Auftrag entnommen',
    });
  } else {
    if (!input.itemId) return { success: false, error: 'item_required' };
    result = await takeUnplannedMaterial(admin, auth.context, {
      jobId: jobContext.job.id,
      projectId: null,
      itemId: input.itemId,
      locationId: input.locationId,
      quantity,
      reason: input.reason,
      defaultReason: 'Für Auftrag entnommen',
    });
  }
  if (!result.success) return result;

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');
  return result;
}

export async function takeProjectMaterial(
  rawInput: Omit<TakeJobMaterialInput, 'jobId'> & { projectId: string },
): Promise<ActionResult<{ quantityAfter: number }>> {
  const parsedInput = takeProjectMaterialSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };
  if (!input.locationId) return { success: false, error: 'location_required' };

  const admin = createSupabaseAdminClient();
  const projectContext = await getProjectContext(admin, auth.context, input.projectId);
  if (!projectContext.success) return projectContext;

  let result: ActionResult<{ quantityAfter: number }>;
  if (input.lineId) {
    const { data: line, error: lineError } = await loggedRead(
      'takeProjectMaterial: job_material_lines read failed',
      admin
        .from('job_material_lines')
        .select('*')
        .eq('id', input.lineId)
        .eq('organization_id', auth.context.orgId)
        .eq('project_id', input.projectId)
        .is('job_id', null)
        .maybeSingle(),
    );
    if (lineError) return { success: false, error: 'load_failed' };
    const existingLine = asRow<JobMaterialLineRow>(line);
    if (!existingLine) return { success: false, error: 'line_not_found' };
    result = await recordMovement(admin, auth.context, {
      itemId: existingLine.item_id,
      locationId: input.locationId,
      movementType: 'job_take',
      quantityDelta: -quantity,
      projectId: projectContext.project.id,
      jobMaterialLineId: existingLine.id,
      reason: input.reason || 'Für Projekt entnommen',
    });
  } else {
    if (!input.itemId) return { success: false, error: 'item_required' };
    result = await takeUnplannedMaterial(admin, auth.context, {
      jobId: null,
      projectId: projectContext.project.id,
      itemId: input.itemId,
      locationId: input.locationId,
      quantity,
      reason: input.reason,
      defaultReason: 'Für Projekt entnommen',
    });
  }
  if (!result.success) return result;

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');
  return result;
}

export async function returnJobMaterial(
  rawInput: ReturnJobMaterialInput,
): Promise<ActionResult<{ quantityAfter: number }>> {
  const parsedInput = returnJobMaterialSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await getAuthContext();
  if (!auth.success) return auth;

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };

  const admin = createSupabaseAdminClient();
  const { data: lineData, error: lineDataError } = await loggedRead(
    'returnJobMaterial: job_material_lines read failed',
    admin
      .from('job_material_lines')
      .select('*')
      .eq('id', input.lineId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (lineDataError) return { success: false, error: 'load_failed' };

  const line = asRow<JobMaterialLineRow>(lineData);
  if (!line) return { success: false, error: 'line_not_found' };

  let jobId: string | null = null;
  let projectId: string | null = null;

  if (line.job_id) {
    const jobContext = await getJobContext(admin, auth.context, line.job_id);
    if (!jobContext.success) return jobContext;
    jobId = jobContext.job.id;
    projectId = jobContext.job.project_id;
  } else if (line.project_id) {
    const projectContext = await getProjectContext(admin, auth.context, line.project_id);
    if (!projectContext.success) return projectContext;
    projectId = projectContext.project.id;
  } else {
    return { success: false, error: 'line_not_found' };
  }

  const stillOut = toNumber(line.taken_quantity) - toNumber(line.returned_quantity);
  if (quantity > stillOut) {
    return { success: false, error: 'return_exceeds_taken' };
  }

  const result = await recordMovement(admin, auth.context, {
    itemId: line.item_id,
    locationId: input.locationId,
    movementType: 'job_return',
    quantityDelta: quantity,
    jobId,
    projectId,
    jobMaterialLineId: line.id,
    reason: input.reason || (jobId ? 'Von Auftrag zurückgelegt' : 'Von Projekt zurückgelegt'),
  });

  if (!result.success) return result;

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');
  return result;
}

/**
 * Books CSV rows directly. A matched row adds its quantity as a receipt; a new
 * item's quantity is its first count. A row with a quantity but no Lager keeps
 * its item and books nothing, counted in `missingLocationCount`.
 */
export async function importInventoryRows(
  rawInput: ImportInventoryRowsInput,
): Promise<ActionResult<{ importedCount: number; missingLocationCount: number; failedCount: number }>> {
  const parsedInput = importInventoryRowsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const fileName = cleanText(input.fileName) ?? 'inventar-import.csv';
  const rows = input.rows.filter((row) => cleanText(row.name));
  if (rows.length === 0) return { success: false, error: 'no_rows' };

  const admin = createSupabaseAdminClient();
  await ensureInventoryDefaults(admin, auth.context);

  const { data: batchData, error: batchError } = await admin
    .from('inventory_import_batches')
    .insert({
      organization_id: auth.context.orgId,
      file_name: fileName,
      status: 'draft',
      column_mapping: input.columnMapping,
      row_count: rows.length,
      created_by: auth.context.userId,
    })
    .select('id')
    .single();

  const batch = asRow<{ id: string }>(batchData);
  if (batchError || !batch) {
    logError('Error creating inventory import batch:', batchError);
    return { success: false, error: 'batch_failed' };
  }

  let importedCount = 0;
  let missingLocationCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    try {
      const name = cleanText(row.name);
      if (!name) {
        failedCount++;
        continue;
      }

      // One row is one transaction: its item, barcode and stock movement commit
      // together, and a failed lookup or write fails the row instead of skipping a step.
      const { data: outcome, error } = await admin.rpc(
        'import_inventory_row',
        rpcArgs('import_inventory_row', {
          p_organization_id: auth.context.orgId,
          p_actor_id: auth.context.userId,
          p_import_batch_id: batch.id,
          p_item: {
            item_type: row.itemType ?? 'material',
            name,
            unit: normalizeInventoryUnitInput(row.unit),
            internal_sku: cleanText(row.internalSku),
            manufacturer: cleanText(row.manufacturer),
            supplier_article_number: cleanText(row.supplierArticleNumber),
            purchase_price_cents: normalizePrice(row.purchasePriceCents),
            sale_price_cents: normalizePrice(row.salePriceCents),
            is_billable: row.isBillable ?? true,
            global_minimum_stock: normalizeQuantity(row.minimumStock ?? 0),
            global_target_stock:
              row.targetStock === null || row.targetStock === undefined
                ? null
                : normalizeQuantity(row.targetStock),
            notes: cleanText(row.notes),
          },
          p_category_name: cleanText(row.categoryName),
          p_supplier_name: cleanText(row.supplierName),
          p_location_name: cleanText(row.locationName),
          p_barcode: cleanText(row.barcode),
          p_quantity: normalizeQuantity(row.quantity ?? 0),
          p_reason: `CSV-Import: ${fileName}`,
        }),
      );
      if (error) {
        inventoryWriteFailure('importInventoryRows: import_inventory_row failed', error, 'save_failed');
        failedCount++;
        continue;
      }

      if (outcome === 'missing_location') missingLocationCount++;
      else importedCount++;
    } catch (error) {
      logError('Unexpected row import error:', error);
      failedCount++;
    }
  }

  const { error: updateError } = await admin
    .from('inventory_import_batches')
    .update({
      status: failedCount > 0 ? 'failed' : 'imported',
      // The batch has no column for rows without a Lager; their items were imported.
      imported_count: importedCount + missingLocationCount,
      failed_count: failedCount,
      completed_at: new Date().toISOString(),
    })
    .eq('organization_id', auth.context.orgId)
    .eq('id', batch.id);

  if (updateError) {
    logError('Error updating inventory import batch:', updateError);
  }

  invalidateInventory();
  return { success: true, importedCount, missingLocationCount, failedCount };
}
