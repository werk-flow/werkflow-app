'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { AdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { AuthContext } from '@/lib/jobs/auth';
import type {
  AdjustInventoryStockInput,
  CreateInventoryLocationInput,
  CreateJobMaterialLineInput,
  CreateProjectMaterialLineInput,
  ReturnJobMaterialInput,
  TakeJobMaterialInput,
  UpdateJobMaterialLineInput,
} from './action-inputs';
import type {
  InventoryLocation,
  InventoryPickerOption,
  ProjectMaterialSummary,
  JobMaterialLine,
} from './types';
import { INVENTORY_PICKER_PAGE_SIZE, toInventoryLocation, toNumber } from './types';
import { loadInventoryPickerOptions } from './catalog-reads';
import { getJobContext, getProjectContext } from './job-project-access';
import { hydrateJobMaterialLines, readProjectMaterialSummary } from './material-line-reads';
import { materialLineChanges, planMaterialLine } from './material-line-writes';
import {
  cleanText,
  ensureInventoryDefaults,
  invalidateInventory,
  normalizeQuantity,
  resolveInventoryLocation,
  takeUnplannedMaterial,
} from './write-support';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  adjustInventoryStockSchema,
  createInventoryLocationSchema,
  createJobMaterialLineSchema,
  createProjectMaterialLineSchema,
  optionalItemIdSchema,
  pickerSearchSchema,
  returnJobMaterialSchema,
  takeJobMaterialSchema,
  takeProjectMaterialSchema,
  updateJobMaterialLineSchema,
} from './action-schemas';

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

async function recordMovement(
  admin: AdminClient,
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
    operationId?: string;
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
      p_operation_id: input.operationId ?? null,
    }),
  );

  if (error) {
    if (error.message === 'return_exceeds_taken') return { success: false, error: 'return_exceeds_taken' };
    if (error.message === 'material_idempotency_conflict')
      return { success: false, error: 'material_idempotency_conflict' };
    if (error.message === 'material_line_item_changed') return { success: false, error: 'line_changed' };
    logError('Error recording inventory movement.', { code: error.code ?? 'unknown' });
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
  const jobContext = await getJobContext(auth.context, jobId);
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
  const parent = await resolveInventoryLocation(admin, auth.context.orgId, input.parentLocationId);
  if (!parent.success) return parent;
  const { data, error } = await admin
    .from('inventory_locations')
    .insert({
      organization_id: auth.context.orgId,
      parent_location_id: parent.referenceId,
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
  return { success: true, location: toInventoryLocation(data) };
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

export async function createJobMaterialLine(
  rawInput: CreateJobMaterialLineInput,
): Promise<ActionResult<{ lineId: string }>> {
  const parsedInput = createJobMaterialLineSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await requireInventoryManager();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const jobContext = await getJobContext(auth.context, input.jobId);
  if (!jobContext.success) return jobContext;

  return planMaterialLine(admin, auth.context, {
    target: { jobId: jobContext.job.id, projectId: null },
    input,
    failureLabel: 'createJobMaterialLine: plan_job_material failed',
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

  return planMaterialLine(admin, auth.context, {
    target: { jobId: null, projectId: projectContext.project.id },
    input,
    failureLabel: 'createProjectMaterialLine: plan_job_material failed',
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

  const changes = await materialLineChanges(admin, auth.context.orgId, existing, input);
  if (!changes.success) return changes;
  const { updateData } = changes;

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

  const line = existing;
  if (!line) return { success: false, error: 'line_not_found' };

  // Used material is built in and stays on its line: the line cannot be removed.
  if (toNumber(line.used_quantity) > 0) return { success: false, error: 'material_use_recorded' };
  // A fully corrected use nets to 0 but stays history: the event ledger decides too.
  const { data: useEvents, error: useEventsError } = await loggedRead(
    'deleteJobMaterialLine: job_material_use_events read failed',
    admin
      .from('job_material_use_events')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('job_material_line_id', lineId)
      .limit(1),
  );
  if (useEventsError) return { success: false, error: 'load_failed' };
  if ((useEvents ?? []).length > 0) return { success: false, error: 'material_use_recorded' };

  // A line with movements is cancelled so its ledger keeps the line; one without
  // is deleted. The quantity filters refuse a movement or use booked after the check.
  const hasMovement = toNumber(line.taken_quantity) > 0 || toNumber(line.returned_quantity) > 0;
  const result = hasMovement
    ? await admin
        .from('job_material_lines')
        .update({ status: 'cancelled' })
        .eq('id', lineId)
        .eq('organization_id', auth.context.orgId)
        .eq('used_quantity', 0)
        .or('taken_quantity.gt.0,returned_quantity.gt.0')
        .select('id')
    : await admin
        .from('job_material_lines')
        .delete()
        .eq('id', lineId)
        .eq('organization_id', auth.context.orgId)
        .eq('used_quantity', 0)
        .eq('taken_quantity', 0)
        .eq('returned_quantity', 0)
        .select('id');

  if (result.error) {
    // A use and its full correction committed after the check above: the line guard refuses.
    if (result.error.message === 'material_use_recorded')
      return { success: false, error: 'material_use_recorded' };
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
  const jobContext = await getJobContext(auth.context, jobId);
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

  const hydrated = await hydrateJobMaterialLines(admin, auth.context.orgId, data);
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

  return readProjectMaterialSummary(admin, auth.context.orgId, projectId);
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
  const jobContext = await getJobContext(auth.context, input.jobId);
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
    const existingLine = line;
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
      operationId: input.operationId,
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
      operationId: input.operationId,
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
    const existingLine = line;
    if (!existingLine) return { success: false, error: 'line_not_found' };
    result = await recordMovement(admin, auth.context, {
      itemId: existingLine.item_id,
      locationId: input.locationId,
      movementType: 'job_take',
      quantityDelta: -quantity,
      projectId: projectContext.project.id,
      jobMaterialLineId: existingLine.id,
      reason: input.reason || 'Für Projekt entnommen',
      operationId: input.operationId,
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
      operationId: input.operationId,
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

  const line = lineData;
  if (!line) return { success: false, error: 'line_not_found' };

  let jobId: string | null = null;
  let projectId: string | null = null;

  if (line.job_id) {
    const jobContext = await getJobContext(auth.context, line.job_id);
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

  // record_inventory_movement refuses a return beyond what is neither used nor
  // returned; it answers a retry first, which a check here would refuse.
  const result = await recordMovement(admin, auth.context, {
    itemId: line.item_id,
    locationId: input.locationId,
    movementType: 'job_return',
    quantityDelta: quantity,
    jobId,
    projectId,
    jobMaterialLineId: line.id,
    reason: input.reason || (jobId ? 'Von Auftrag zurückgelegt' : 'Von Projekt zurückgelegt'),
    operationId: input.operationId,
  });

  if (!result.success) return result;

  invalidateInventory();
  revalidatePath('/auftraege', 'layout');
  return result;
}
