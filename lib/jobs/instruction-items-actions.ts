'use server';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { loggedRead, logReadFailure } from '@/lib/data/read-request-cache';
import { revalidatePath } from 'next/cache';

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { toProfileReference, type ProfileReferenceRow } from '@/lib/profile-reference';
import type { Json } from '@/lib/supabase/database.types';

import { authenticateAndAuthorize } from './auth';
import { workWriteFailure } from './write-refusals';
import {
  toJobInstructionItem,
  type CreateJobInstructionItemResult,
  type DeleteJobInstructionItemResult,
  type GetJobInstructionItemsResult,
  type JobInstructionItemRow,
  type JobInstructionItemWithDetails,
  type ReorderJobInstructionItemsResult,
  type ToggleJobInstructionItemCompletionResult,
  type UpdateJobInstructionItemResult,
} from './types';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// Boundary schemas: every argument is bounded before use. The detail limits
// mirror update_instruction_item_details, which rejects longer values.
const MAX_INSTRUCTION_ITEMS = 1000;
const instructionContentSchema = z.string().max(10_000);
const instructionItemIdsSchema = z.array(uuidSchema).max(MAX_INSTRUCTION_ITEMS);
const createProjectItemSchema = z.object({ projectId: uuidSchema, content: instructionContentSchema });
const reorderProjectItemsSchema = z.object({ projectId: uuidSchema, itemIds: instructionItemIdsSchema });
const createJobItemSchema = z.object({
  jobId: uuidSchema,
  content: instructionContentSchema,
  afterItemId: uuidSchema.nullish(),
});
const updateItemContentSchema = z.object({ itemId: uuidSchema, content: instructionContentSchema });
const itemTargetSchema = z.object({ itemId: uuidSchema });
const toggleItemSchema = z.object({ itemId: uuidSchema, isCompleted: z.boolean().optional() });
const reorderJobItemsSchema = z.object({ jobId: uuidSchema, itemIds: instructionItemIdsSchema });
const itemDetailsSchema = z.object({
  itemId: uuidSchema,
  itemKind: z.enum(['task', 'checklist']),
  requirementState: z.enum(['required', 'optional']),
  groupLabel: z.string().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
  evidence: z
    .array(
      z.object({
        id: uuidSchema,
        description: z.string().max(2000),
        documentCategory: z.string().max(100),
        sortOrder: z.number().int().min(0).max(MAX_INSTRUCTION_ITEMS),
      }),
    )
    .max(100),
  predecessorItemIds: instructionItemIdsSchema,
});

type AuthorizedJobContext =
  | {
      success: true;
      admin: AdminClient;
      jobId: string;
      orgId: string;
      userId: string;
      isManagerOrAbove: boolean;
    }
  | ActionFailure;

type AuthorizedItemContext =
  | {
      success: true;
      admin: AdminClient;
      item: JobInstructionItemRow;
      orgId: string;
      userId: string;
      isManagerOrAbove: boolean;
    }
  | ActionFailure;

type CreateJobInstructionItemInput = {
  jobId: string;
  content: string;
  afterItemId?: string | null;
};

type UpdateJobInstructionItemInput = {
  itemId: string;
  content: string;
};

type DeleteJobInstructionItemInput = {
  itemId: string;
};

type ToggleJobInstructionItemCompletionInput = {
  itemId: string;
  isCompleted?: boolean;
};

type ReorderJobInstructionItemsInput = {
  jobId: string;
  itemIds: string[];
};

async function getAuthorizedJobContext(jobId: string): Promise<AuthorizedJobContext> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { userId, orgId, isManagerOrAbove } = auth.context;

  const { data: job, error: jobError } = await loggedRead(
    'getAuthorizedJobContext: jobs read failed',
    admin.from('jobs').select('id').eq('id', jobId).eq('organization_id', orgId).maybeSingle(),
  );
  if (jobError) return { success: false, error: 'load_failed' };

  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (!isManagerOrAbove) {
    const { data: assignment, error: assignmentError } = await loggedRead(
      'getAuthorizedJobContext: job_assignments read failed',
      admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('job_id', jobId)
        .eq('user_id', userId)
        .maybeSingle(),
    );
    if (assignmentError) return { success: false, error: 'load_failed' };

    if (!assignment) {
      return { success: false, error: 'not_authorized' };
    }
  }

  return {
    success: true,
    admin,
    jobId: job.id,
    orgId,
    userId,
    isManagerOrAbove,
  };
}

async function getAuthorizedItemContext(itemId: string): Promise<AuthorizedItemContext> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { userId, orgId, isManagerOrAbove } = auth.context;

  const { data: item, error: itemError } = await loggedRead(
    'getAuthorizedItemContext: job_instruction_items read failed',
    admin
      .from('job_instruction_items')
      .select('*')
      .eq('id', itemId)
      .eq('organization_id', orgId)
      .maybeSingle(),
  );
  if (itemError) return { success: false, error: 'load_failed' };

  if (!item) {
    return { success: false, error: 'item_not_found' };
  }

  if (!isManagerOrAbove) {
    // A project-level item has no job assignment that could authorize a non-manager.
    if (item.job_id === null) {
      return { success: false, error: 'not_authorized' };
    }
    const { data: assignment, error: assignmentError } = await loggedRead(
      'getAuthorizedItemContext: job_assignments read failed',
      admin
        .from('job_assignments')
        .select('id')
        .eq('organization_id', orgId)
        .eq('job_id', item.job_id)
        .eq('user_id', userId)
        .maybeSingle(),
    );
    if (assignmentError) return { success: false, error: 'load_failed' };

    if (!assignment) {
      return { success: false, error: 'not_authorized' };
    }
  }

  return {
    success: true,
    admin,
    item,
    orgId,
    userId,
    isManagerOrAbove,
  };
}

/**
 * Adds provenance, evidence and predecessors to the rows. Returns null when any
 * of these reads fails, so no caller shows an item without its requirements.
 */
async function hydrateInstructionItems(
  admin: AdminClient,
  orgId: string,
  rows: JobInstructionItemRow[],
): Promise<JobInstructionItemWithDetails[] | null> {
  const profileIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        [row.created_by, row.last_status_changed_by].filter((value): value is string => Boolean(value)),
      ),
    ),
  );

  const profileMap = new Map<string, ProfileReferenceRow>();
  const itemIds = rows.map((row) => row.id);

  // Each batch holds whole items, so the per-item `sort_order` survives batching.
  const [profilesResult, evidenceResult, dependencyResult] = await Promise.all([
    readInBatches(profileIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email, avatar_path')
        .in('id', [...batch]),
    ),
    readInBatches(itemIds, (batch) =>
      admin
        .from('job_instruction_item_evidence_requirements')
        .select('id, instruction_item_id, description, document_category')
        .eq('organization_id', orgId)
        .in('instruction_item_id', [...batch])
        .order('sort_order'),
    ),
    readInBatches(itemIds, (batch) =>
      admin
        .from('job_instruction_item_dependencies')
        .select('dependent_item_id, predecessor_item_id')
        .eq('organization_id', orgId)
        .in('dependent_item_id', [...batch]),
    ),
  ]);
  const metadataError = profilesResult.error ?? evidenceResult.error ?? dependencyResult.error;
  if (metadataError) {
    logReadFailure('hydrateInstructionItems: metadata read failed', { code: metadataError.code });
    return null;
  }
  for (const profile of profilesResult.data) profileMap.set(profile.id, profile);
  const requirementIds = evidenceResult.data.map((requirement) => requirement.id);
  const contentById = new Map(rows.map((row) => [row.id, row.content]));
  // A single saved item is hydrated alone; its predecessors still need their labels.
  const missingPredecessorIds = dependencyResult.data
    .map((dependency) => dependency.predecessor_item_id)
    .filter((predecessorId) => !contentById.has(predecessorId));
  const [fulfillmentResult, predecessorResult] = await Promise.all([
    readInBatches(requirementIds, (batch) =>
      admin
        .from('job_instruction_item_evidence_fulfillments')
        .select('id, evidence_requirement_id, document_id, artifact_revision_id, version')
        .eq('organization_id', orgId)
        .in('evidence_requirement_id', [...batch])
        .is('removed_at', null),
    ),
    readInBatches(missingPredecessorIds, (batch) =>
      admin
        .from('job_instruction_items')
        .select('id, content')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
  ]);
  const detailError = fulfillmentResult.error ?? predecessorResult.error;
  if (detailError) {
    logReadFailure('hydrateInstructionItems: fulfillment or predecessor read failed', {
      code: detailError.code,
    });
    return null;
  }
  for (const predecessor of predecessorResult.data) contentById.set(predecessor.id, predecessor.content);
  const fulfillmentByRequirementId = new Map(
    fulfillmentResult.data.map((fulfillment) => [
      fulfillment.evidence_requirement_id,
      {
        id: fulfillment.id,
        documentId: fulfillment.document_id,
        artifactRevisionId: fulfillment.artifact_revision_id,
        version: fulfillment.version,
      },
    ]),
  );
  return rows.map((row) => ({
    ...toJobInstructionItem(row),
    creator: toProfileReference(profileMap.get(row.created_by)),
    lastStatusChangedByProfile: toProfileReference(
      row.last_status_changed_by ? profileMap.get(row.last_status_changed_by) : null,
    ),
    evidenceRequirements: evidenceResult.data
      .filter((item) => item.instruction_item_id === row.id)
      .map((item) => ({
        id: item.id,
        description: item.description,
        documentCategory: item.document_category,
        fulfillment: fulfillmentByRequirementId.get(item.id) ?? null,
      })),
    predecessors: dependencyResult.data
      .filter((item) => item.dependent_item_id === row.id)
      .map((item) => ({
        id: item.predecessor_item_id,
        content: contentById.get(item.predecessor_item_id) ?? 'Früherer Eintrag',
      })),
  }));
}

/** The job or the project whose instruction list is read. */
type InstructionListOwner = { column: 'job_id' | 'project_id'; id: string };

/** The list rows in display order, or null when the read fails. */
async function readInstructionItemRows(
  admin: AdminClient,
  orgId: string,
  owner: InstructionListOwner,
): Promise<JobInstructionItemRow[] | null> {
  const { data: rows, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('job_instruction_items')
        .select('*')
        .eq('organization_id', orgId)
        .eq(owner.column, owner.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logReadFailure('readInstructionItemRows: job_instruction_items read failed', error);
    return null;
  }
  return rows;
}

async function readInstructionItemIds(
  admin: AdminClient,
  orgId: string,
  owner: InstructionListOwner,
): Promise<string[] | null> {
  const rows = await readInstructionItemRows(admin, orgId, owner);
  return rows ? rows.map((row) => row.id) : null;
}

async function getHydratedInstructionItems(
  admin: AdminClient,
  orgId: string,
  owner: InstructionListOwner,
): Promise<GetJobInstructionItemsResult> {
  const rows = await readInstructionItemRows(admin, orgId, owner);
  const items = rows ? await hydrateInstructionItems(admin, orgId, rows) : null;
  return items ? { success: true, items } : { success: false, error: 'fetch_failed' };
}

/** The saved item after a write; a failed read is `fetch_failed`, never `item_not_found`. */
async function getHydratedInstructionItemById(
  admin: AdminClient,
  orgId: string,
  itemId: string,
): Promise<ActionResult<{ item: JobInstructionItemWithDetails }>> {
  const { data: row, error } = await loggedRead(
    'getHydratedInstructionItemById: job_instruction_items read failed',
    admin
      .from('job_instruction_items')
      .select('*')
      .eq('organization_id', orgId)
      .eq('id', itemId)
      .maybeSingle(),
  );

  if (error) return { success: false, error: 'fetch_failed' };
  if (!row) return { success: false, error: 'item_not_found' };

  const [item] = (await hydrateInstructionItems(admin, orgId, [row])) ?? [];
  return item ? { success: true, item } : { success: false, error: 'fetch_failed' };
}

/**
 * Puts the whole list in the given order in one transaction; the function
 * refuses with invalid_reorder unless the ids are exactly the current list.
 */
async function persistInstructionItemOrder(
  admin: AdminClient,
  orgId: string,
  owner: InstructionListOwner,
  orderedIds: string[],
): Promise<ActionResult> {
  const { error } = await admin.rpc(
    'reorder_instruction_items',
    rpcArgs('reorder_instruction_items', {
      p_organization_id: orgId,
      p_job_id: owner.column === 'job_id' ? owner.id : null,
      p_project_id: owner.column === 'project_id' ? owner.id : null,
      p_item_ids: orderedIds,
    }),
  );
  if (error) {
    return workWriteFailure(
      'Failed to persist instruction item order:',
      error,
      ['invalid_reorder', 'job_not_found', 'project_not_found'],
      'reorder_failed',
    );
  }
  return { success: true };
}

function revalidateInstructionItemPaths() {
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/mitarbeiter', 'layout');
}

async function getAuthorizedProjectContext(projectId: string) {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data: project, error: projectError } = await loggedRead(
    'getAuthorizedProjectContext: projects read failed',
    admin
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (projectError) return { success: false as const, error: 'load_failed' };
  if (!project) return { success: false as const, error: 'project_not_found' };
  return { success: true as const, admin, projectId, orgId: auth.context.orgId, userId: auth.context.userId };
}

export async function getProjectInstructionItems(
  rawProjectId: string,
): Promise<GetJobInstructionItemsResult> {
  const parsedProjectId = uuidSchema.safeParse(rawProjectId);
  if (!parsedProjectId.success) return { success: false as const, error: 'project_not_found' };
  const context = await getAuthorizedProjectContext(parsedProjectId.data);
  if (!context.success) return context;
  return getHydratedInstructionItems(context.admin, context.orgId, {
    column: 'project_id',
    id: context.projectId,
  });
}

export async function createProjectInstructionItem(rawInput: {
  projectId: string;
  content: string;
}): Promise<CreateJobInstructionItemResult> {
  const parsedInput = createProjectItemSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false as const, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await getAuthorizedProjectContext(input.projectId);
  if (!context.success) return context;
  const content = input.content.trim();
  if (!content) return { success: false as const, error: 'content_required' };
  const currentIds = await readInstructionItemIds(context.admin, context.orgId, {
    column: 'project_id',
    id: input.projectId,
  });
  if (!currentIds) return { success: false as const, error: 'create_failed' };
  const { data: row, error } = await context.admin
    .from('job_instruction_items')
    .insert({
      organization_id: context.orgId,
      project_id: input.projectId,
      content,
      sort_order: currentIds.length,
      created_by: context.userId,
    })
    .select('*')
    .single();
  if (error || !row) {
    logError('Failed to create project instruction item:', error);
    return { success: false as const, error: 'create_failed' };
  }
  revalidateInstructionItemPaths();
  return getHydratedInstructionItemById(context.admin, context.orgId, row.id);
}

export async function reorderProjectInstructionItems(rawInput: {
  projectId: string;
  itemIds: string[];
}): Promise<ReorderJobInstructionItemsResult> {
  const parsedInput = reorderProjectItemsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false as const, error: 'invalid_reorder' };
  const input = parsedInput.data;
  const context = await getAuthorizedProjectContext(input.projectId);
  if (!context.success) return context;
  const result = await persistInstructionItemOrder(
    context.admin,
    context.orgId,
    { column: 'project_id', id: input.projectId },
    input.itemIds,
  );
  if (!result.success) return result;
  revalidateInstructionItemPaths();
  return { success: true as const };
}

export async function getJobInstructionItems(rawJobId: string): Promise<GetJobInstructionItemsResult> {
  const parsedJobId = uuidSchema.safeParse(rawJobId);
  if (!parsedJobId.success) return { success: false, error: 'job_not_found' };
  const context = await getAuthorizedJobContext(parsedJobId.data);
  if (!context.success) return context;

  return getHydratedInstructionItems(context.admin, context.orgId, { column: 'job_id', id: context.jobId });
}

export async function createJobInstructionItem(
  rawInput: CreateJobInstructionItemInput,
): Promise<CreateJobInstructionItemResult> {
  const parsedInput = createJobItemSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await getAuthorizedJobContext(input.jobId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const content = input.content.trim();
  if (!content) {
    return { success: false, error: 'content_required' };
  }

  // One transaction: the insert after the named item and the renumbered list.
  const { data: createdItemId, error } = await context.admin.rpc(
    'create_job_instruction_item',
    rpcArgs('create_job_instruction_item', {
      p_organization_id: context.orgId,
      p_job_id: context.jobId,
      p_actor_id: context.userId,
      p_content: content,
      p_after_item_id: input.afterItemId ?? null,
    }),
  );

  if (error) {
    return workWriteFailure(
      'Failed to create instruction item:',
      error,
      ['job_not_found', 'content_required', 'item_not_found'],
      'create_failed',
    );
  }

  revalidateInstructionItemPaths();

  return getHydratedInstructionItemById(context.admin, context.orgId, createdItemId);
}

export async function updateJobInstructionItemContent(
  rawInput: UpdateJobInstructionItemInput,
): Promise<UpdateJobInstructionItemResult> {
  const parsedInput = updateItemContentSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const content = input.content.trim();
  if (!content) {
    return { success: false, error: 'content_required' };
  }

  const { data: row, error } = await context.admin
    .from('job_instruction_items')
    .update({
      content,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', context.orgId)
    .eq('id', context.item.id)
    .select('*')
    .single();

  if (error || !row) {
    logError('Failed to update instruction item content:', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateInstructionItemPaths();

  return getHydratedInstructionItemById(context.admin, context.orgId, row.id);
}

export async function deleteJobInstructionItem(
  rawInput: DeleteJobInstructionItemInput,
): Promise<DeleteJobInstructionItemResult> {
  const parsedInput = itemTargetSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  // One transaction: the delete and the renumbered rest of the list.
  const { error } = await context.admin.rpc(
    'delete_instruction_item',
    rpcArgs('delete_instruction_item', { p_organization_id: context.orgId, p_item_id: context.item.id }),
  );

  if (error) {
    return workWriteFailure('Failed to delete instruction item:', error, ['item_not_found'], 'delete_failed');
  }

  revalidateInstructionItemPaths();
  return { success: true };
}

export async function toggleJobInstructionItemCompletion(
  rawInput: ToggleJobInstructionItemCompletionInput,
): Promise<ToggleJobInstructionItemCompletionResult> {
  const parsedInput = toggleItemSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;

  const nextCompleted = input.isCompleted ?? !context.item.is_completed;
  const { error } = await context.admin.rpc('set_instruction_item_completion', {
    p_organization_id: context.orgId,
    p_actor_id: context.userId,
    p_instruction_item_id: context.item.id,
    p_expected_version: context.item.completion_version,
    p_is_completed: nextCompleted,
  });

  if (error) {
    logError('Failed to toggle instruction item completion:', error);
    const known = ['instruction_predecessor_incomplete', 'instruction_item_stale_version'].find((code) =>
      error.message.includes(code),
    );
    return { success: false, error: known ?? 'toggle_failed' };
  }

  revalidateInstructionItemPaths();

  return getHydratedInstructionItemById(context.admin, context.orgId, context.item.id);
}

export async function reorderJobInstructionItems(
  rawInput: ReorderJobInstructionItemsInput,
): Promise<ReorderJobInstructionItemsResult> {
  const parsedInput = reorderJobItemsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_reorder' };
  const input = parsedInput.data;
  const context = await getAuthorizedJobContext(input.jobId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const reorderResult = await persistInstructionItemOrder(
    context.admin,
    context.orgId,
    { column: 'job_id', id: context.jobId },
    input.itemIds,
  );
  if (!reorderResult.success) {
    return reorderResult;
  }

  revalidateInstructionItemPaths();
  return { success: true };
}

export async function updateInstructionItemDetails(rawInput: {
  itemId: string;
  itemKind: 'task' | 'checklist';
  requirementState: 'required' | 'optional';
  groupLabel?: string | null;
  notes?: string | null;
  evidence: Array<{ id: string; description: string; documentCategory: string; sortOrder: number }>;
  predecessorItemIds: string[];
}): Promise<UpdateJobInstructionItemResult> {
  const parsedInput = itemDetailsSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false as const, error: 'instruction_item_details_invalid' };
  const input = parsedInput.data;
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;
  if (!context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const { error } = await context.admin.rpc(
    'update_instruction_item_details',
    rpcArgs('update_instruction_item_details', {
      p_organization_id: context.orgId,
      p_instruction_item_id: input.itemId,
      p_actor_id: context.userId,
      p_item_kind: input.itemKind,
      p_requirement_state: input.requirementState,
      p_group_label: input.groupLabel ?? null,
      p_notes: input.notes ?? null,
      p_evidence: input.evidence.map((item) => ({
        id: item.id,
        description: item.description.trim(),
        document_category: item.documentCategory,
        sort_order: item.sortOrder,
      })) as Json,
      p_predecessor_item_ids: input.predecessorItemIds,
    }),
  );
  if (error) {
    const known = [
      'instruction_dependency_cycle',
      'instruction_dependency_self',
      'instruction_dependency_target_invalid',
      'instruction_item_details_invalid',
    ].find((code) => error.message.includes(code));
    return { success: false as const, error: known ?? 'update_failed' };
  }
  revalidateInstructionItemPaths();
  return getHydratedInstructionItemById(context.admin, context.orgId, input.itemId);
}
