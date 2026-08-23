'use server';

import { revalidatePath, updateTag } from 'next/cache';

import { CACHE_TAGS } from '@/lib/data/cached';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/database.types';

import { authenticateAndAuthorize } from './auth';
import {
  toJobInstructionItem,
  type CreateJobInstructionItemResult,
  type DeleteJobInstructionItemResult,
  type GetJobInstructionItemsResult,
  type JobInstructionActor,
  type JobInstructionItemRow,
  type JobInstructionItemWithDetails,
  type ReorderJobInstructionItemsResult,
  type ToggleJobInstructionItemCompletionResult,
  type UpdateJobInstructionItemResult,
} from './types';

type AuthorizedJobContext =
  | {
      success: true;
      admin: ReturnType<typeof createSupabaseAdminClient>;
      jobId: string;
      orgId: string;
      userId: string;
      isManagerOrAbove: boolean;
    }
  | { success: false; error: string };

type AuthorizedItemContext =
  | {
      success: true;
      admin: ReturnType<typeof createSupabaseAdminClient>;
      item: JobInstructionItemRow;
      orgId: string;
      userId: string;
      isManagerOrAbove: boolean;
    }
  | { success: false; error: string };

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

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_path: string | null;
};

function trimInstructionContent(content: string): string {
  return content.trim();
}

function mapProfileToActor(profile?: ProfileRow | null): JobInstructionActor | null {
  if (!profile) return null;

  return {
    userId: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    email: profile.email,
    avatarPath: profile.avatar_path,
  };
}

async function getAuthorizedJobContext(jobId: string): Promise<AuthorizedJobContext> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;

  const admin = createSupabaseAdminClient();
  const { userId, orgId, isManagerOrAbove } = auth.context;

  const { data: job } = await admin
    .from('jobs')
    .select('id')
    .eq('id', jobId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (!job) {
    return { success: false, error: 'job_not_found' };
  }

  if (!isManagerOrAbove) {
    const { data: assignment } = await admin
      .from('job_assignments')
      .select('id')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .maybeSingle();

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

  const { data: item } = await admin
    .from('job_instruction_items')
    .select('*')
    .eq('id', itemId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (!item) {
    return { success: false, error: 'item_not_found' };
  }

  if (!isManagerOrAbove) {
    const { data: assignment } = await admin
      .from('job_assignments')
      .select('id')
      .eq('job_id', item.job_id)
      .eq('user_id', userId)
      .maybeSingle();

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

async function hydrateInstructionItems(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  rows: JobInstructionItemRow[]
): Promise<JobInstructionItemWithDetails[]> {
  const profileIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        [row.created_by, row.last_status_changed_by].filter(
          (value): value is string => Boolean(value)
        )
      )
    )
  );

  const profileMap = new Map<string, ProfileRow>();
  const itemIds = rows.map((row) => row.id);

  if (profileIds.length > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, first_name, last_name, email, avatar_path')
      .in('id', profileIds);

    for (const profile of profiles ?? []) {
      profileMap.set(profile.id, profile);
    }
  }

  const [evidenceResult, dependencyResult] = itemIds.length > 0
    ? await Promise.all([
        admin.from('job_instruction_item_evidence_requirements').select('id, instruction_item_id, description, document_category').in('instruction_item_id', itemIds).order('sort_order'),
        admin.from('job_instruction_item_dependencies').select('dependent_item_id, predecessor_item_id').in('dependent_item_id', itemIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (evidenceResult.error || dependencyResult.error) {
    console.error('Failed to hydrate instruction item template metadata:', evidenceResult.error ?? dependencyResult.error);
  }
  const contentById = new Map(rows.map((row) => [row.id, row.content]));

  return rows.map((row) => ({
    ...toJobInstructionItem(row),
    creator: mapProfileToActor(profileMap.get(row.created_by)),
    lastStatusChangedByProfile: mapProfileToActor(
      row.last_status_changed_by
        ? profileMap.get(row.last_status_changed_by)
        : null
    ),
    evidenceRequirements: (evidenceResult.data ?? []).filter((item) => item.instruction_item_id === row.id).map((item) => ({ id: item.id, description: item.description, documentCategory: item.document_category })),
    predecessors: (dependencyResult.data ?? []).filter((item) => item.dependent_item_id === row.id).map((item) => ({ id: item.predecessor_item_id, content: contentById.get(item.predecessor_item_id) ?? 'Früherer Eintrag' })),
  }));
}

async function getHydratedInstructionItemsForJob(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  jobId: string
): Promise<JobInstructionItemWithDetails[]> {
  const { data: rows } = await admin
    .from('job_instruction_items')
    .select('*')
    .eq('job_id', jobId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  return hydrateInstructionItems(admin, rows ?? []);
}

async function getHydratedInstructionItemsForProject(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  projectId: string
): Promise<JobInstructionItemWithDetails[]> {
  const { data: rows } = await admin
    .from('job_instruction_items')
    .select('*')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return hydrateInstructionItems(admin, rows ?? []);
}

async function getHydratedInstructionItemById(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  itemId: string
): Promise<JobInstructionItemWithDetails | null> {
  const { data: row } = await admin
    .from('job_instruction_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();

  if (!row) return null;

  const [item] = await hydrateInstructionItems(admin, [row]);
  return item ?? null;
}

async function persistInstructionItemOrder(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orderedIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  const updatedAt = new Date().toISOString();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      admin
        .from('job_instruction_items')
        .update({
          sort_order: index,
          updated_at: updatedAt,
        })
        .eq('id', id)
    )
  );

  const failedResult = results.find((result) => result.error);

  if (failedResult?.error) {
    console.error('Failed to persist instruction item order:', failedResult.error);
    return { success: false, error: 'reorder_failed' };
  }

  return { success: true };
}

function revalidateInstructionItemPaths(orgId: string) {
  updateTag(CACHE_TAGS.jobs(orgId));
  updateTag(CACHE_TAGS.projects(orgId));
  revalidatePath('/auftraege', 'layout');
  revalidatePath('/mitarbeiter', 'layout');
}

async function getAuthorizedProjectContext(projectId: string) {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const admin = createSupabaseAdminClient();
  const { data: project } = await admin.from('projects').select('id').eq('id', projectId).eq('organization_id', auth.context.orgId).maybeSingle();
  if (!project) return { success: false as const, error: 'project_not_found' };
  return { success: true as const, admin, projectId, orgId: auth.context.orgId, userId: auth.context.userId };
}

async function getProjectInstructionItemIds(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  projectId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from('job_instruction_items')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;
  return (data ?? []).map((row) => row.id);
}

export async function getProjectInstructionItems(
  projectId: string
): Promise<GetJobInstructionItemsResult> {
  const context = await getAuthorizedProjectContext(projectId);
  if (!context.success) return context;
  return { success: true as const, items: await getHydratedInstructionItemsForProject(context.admin, projectId) };
}

export async function createProjectInstructionItem(input: {
  projectId: string;
  content: string;
}): Promise<CreateJobInstructionItemResult> {
  const context = await getAuthorizedProjectContext(input.projectId);
  if (!context.success) return context;
  const content = trimInstructionContent(input.content);
  if (!content) return { success: false as const, error: 'content_required' };
  const currentIds = await getProjectInstructionItemIds(context.admin, context.orgId, input.projectId);
  const { data: row, error } = await context.admin.from('job_instruction_items').insert({
    organization_id: context.orgId,
    project_id: input.projectId,
    content,
    sort_order: currentIds.length,
    created_by: context.userId,
  }).select('*').single();
  if (error || !row) return { success: false as const, error: 'create_failed' };
  revalidateInstructionItemPaths(context.orgId);
  const item = await getHydratedInstructionItemById(context.admin, row.id);
  return item ? { success: true as const, item } : { success: false as const, error: 'item_not_found' };
}

export async function reorderProjectInstructionItems(input: {
  projectId: string;
  itemIds: string[];
}): Promise<ReorderJobInstructionItemsResult> {
  const context = await getAuthorizedProjectContext(input.projectId);
  if (!context.success) return context;
  const currentIds = new Set(await getProjectInstructionItemIds(context.admin, context.orgId, input.projectId));
  if (input.itemIds.length !== currentIds.size || new Set(input.itemIds).size !== input.itemIds.length || input.itemIds.some((id) => !currentIds.has(id))) {
    return { success: false as const, error: 'invalid_reorder' };
  }
  const result = await persistInstructionItemOrder(context.admin, input.itemIds);
  if (!result.success) return result;
  revalidateInstructionItemPaths(context.orgId);
  return { success: true as const };
}

export async function getJobInstructionItems(
  jobId: string
): Promise<GetJobInstructionItemsResult> {
  const context = await getAuthorizedJobContext(jobId);
  if (!context.success) return context;

  const items = await getHydratedInstructionItemsForJob(context.admin, context.jobId);
  return { success: true, items };
}

export async function createJobInstructionItem(
  input: CreateJobInstructionItemInput
): Promise<CreateJobInstructionItemResult> {
  const context = await getAuthorizedJobContext(input.jobId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const content = trimInstructionContent(input.content);
  if (!content) {
    return { success: false, error: 'content_required' };
  }

  const currentItems = await getHydratedInstructionItemsForJob(context.admin, context.jobId);
  const orderedIds = currentItems.map((item) => item.id);

  let insertIndex = orderedIds.length;
  if (input.afterItemId) {
    const afterIndex = orderedIds.indexOf(input.afterItemId);
    if (afterIndex === -1) {
      return { success: false, error: 'item_not_found' };
    }

    insertIndex = afterIndex + 1;
  }

  const { data: createdRow, error } = await context.admin
    .from('job_instruction_items')
    .insert({
      organization_id: context.orgId,
      job_id: context.jobId,
      content,
      sort_order: orderedIds.length,
      created_by: context.userId,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error || !createdRow) {
    console.error('Failed to create instruction item:', error);
    return { success: false, error: 'create_failed' };
  }

  const nextOrder = [...orderedIds];
  nextOrder.splice(insertIndex, 0, createdRow.id);

  const reorderResult = await persistInstructionItemOrder(context.admin, nextOrder);
  if (!reorderResult.success) {
    return reorderResult;
  }

  revalidateInstructionItemPaths(context.orgId);

  const item = await getHydratedInstructionItemById(context.admin, createdRow.id);
  if (!item) {
    return { success: false, error: 'item_not_found' };
  }

  return { success: true, item };
}

export async function updateJobInstructionItemContent(
  input: UpdateJobInstructionItemInput
): Promise<UpdateJobInstructionItemResult> {
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const content = trimInstructionContent(input.content);
  if (!content) {
    return { success: false, error: 'content_required' };
  }

  const { data: row, error } = await context.admin
    .from('job_instruction_items')
    .update({
      content,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.itemId)
    .select('*')
    .single();

  if (error || !row) {
    console.error('Failed to update instruction item content:', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateInstructionItemPaths(context.orgId);

  const item = await getHydratedInstructionItemById(context.admin, row.id);
  if (!item) {
    return { success: false, error: 'item_not_found' };
  }

  return { success: true, item };
}

export async function deleteJobInstructionItem(
  input: DeleteJobInstructionItemInput
): Promise<DeleteJobInstructionItemResult> {
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const { error } = await context.admin
    .from('job_instruction_items')
    .delete()
    .eq('id', context.item.id);

  if (error) {
    console.error('Failed to delete instruction item:', error);
    return { success: false, error: 'delete_failed' };
  }

  if (!context.item.job_id) {
    const remainingItems = await getHydratedInstructionItemsForProject(
      context.admin,
      context.item.project_id!
    );
    const reorderResult = await persistInstructionItemOrder(
      context.admin,
      remainingItems.map((item) => item.id)
    );
    if (!reorderResult.success) return reorderResult;
    revalidateInstructionItemPaths(context.orgId);
    return { success: true };
  }
  const remainingItems = await getHydratedInstructionItemsForJob(
    context.admin,
    context.item.job_id
  );
  const reorderResult = await persistInstructionItemOrder(
    context.admin,
    remainingItems.map((item) => item.id)
  );

  if (!reorderResult.success) {
    return reorderResult;
  }

  revalidateInstructionItemPaths(context.orgId);
  return { success: true };
}

export async function toggleJobInstructionItemCompletion(
  input: ToggleJobInstructionItemCompletionInput
): Promise<ToggleJobInstructionItemCompletionResult> {
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;

  const nextCompleted = input.isCompleted ?? !context.item.is_completed;
  const timestamp = new Date().toISOString();

  const { data: row, error } = await context.admin
    .from('job_instruction_items')
    .update({
      is_completed: nextCompleted,
      last_status_changed_by: context.userId,
      last_status_changed_at: timestamp,
      updated_at: timestamp,
    })
    .eq('id', context.item.id)
    .select('*')
    .single();

  if (error || !row) {
    console.error('Failed to toggle instruction item completion:', error);
    return { success: false, error: 'toggle_failed' };
  }

  revalidateInstructionItemPaths(context.orgId);

  const item = await getHydratedInstructionItemById(context.admin, row.id);
  if (!item) {
    return { success: false, error: 'item_not_found' };
  }

  return { success: true, item };
}

export async function reorderJobInstructionItems(
  input: ReorderJobInstructionItemsInput
): Promise<ReorderJobInstructionItemsResult> {
  const context = await getAuthorizedJobContext(input.jobId);
  if (!context.success) return context;

  if (!context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }

  const currentItems = await getHydratedInstructionItemsForJob(context.admin, context.jobId);
  const currentIds = currentItems.map((item) => item.id);

  if (
    input.itemIds.length !== currentIds.length ||
    new Set(input.itemIds).size !== input.itemIds.length
  ) {
    return { success: false, error: 'invalid_reorder' };
  }

  const currentIdSet = new Set(currentIds);
  if (input.itemIds.some((itemId) => !currentIdSet.has(itemId))) {
    return { success: false, error: 'invalid_reorder' };
  }

  const reorderResult = await persistInstructionItemOrder(context.admin, input.itemIds);
  if (!reorderResult.success) {
    return reorderResult;
  }

  revalidateInstructionItemPaths(context.orgId);
  return { success: true };
}

export async function updateInstructionItemDetails(input: {
  itemId: string;
  itemKind: 'task' | 'checklist';
  requirementState: 'required' | 'optional';
  groupLabel?: string | null;
  notes?: string | null;
  evidence: Array<{ id: string; description: string; documentCategory: string; sortOrder: number }>;
  predecessorItemIds: string[];
}): Promise<UpdateJobInstructionItemResult> {
  const context = await getAuthorizedItemContext(input.itemId);
  if (!context.success) return context;
  if (!context.isManagerOrAbove) return { success: false as const, error: 'not_authorized' };
  const { error } = await context.admin.rpc('update_instruction_item_details', {
    p_organization_id: context.orgId,
    p_instruction_item_id: input.itemId,
    p_actor_id: context.userId,
    p_item_kind: input.itemKind,
    p_requirement_state: input.requirementState,
    p_group_label: input.groupLabel ?? null,
    p_notes: input.notes ?? null,
    p_evidence: input.evidence.map((item) => ({ id: item.id, description: item.description.trim(), document_category: item.documentCategory, sort_order: item.sortOrder })) as Json,
    p_predecessor_item_ids: input.predecessorItemIds,
  });
  if (error) {
    const known = ['instruction_dependency_cycle', 'instruction_dependency_self', 'instruction_dependency_target_invalid', 'instruction_item_details_invalid'].find((code) => error.message.includes(code));
    return { success: false as const, error: known ?? 'update_failed' };
  }
  revalidateInstructionItemPaths(context.orgId);
  const item = await getHydratedInstructionItemById(context.admin, input.itemId);
  return item ? { success: true as const, item } : { success: false as const, error: 'item_not_found' };
}
