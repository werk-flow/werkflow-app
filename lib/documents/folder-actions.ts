'use server';

import type { ActionResult } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { readAllRows, readCompleteRows, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { ensureFolder, getAuthorizedDocumentContext, getFolderById, requireManager } from './access';
import {
  copyFolderInputSchema,
  createFolderInputSchema,
  INVALID_INPUT,
  moveFolderInputSchema,
  parseActionInput,
  renameFolderInputSchema,
  type CopyFolderInput,
  type CreateFolderInput,
  type MoveFolderInput,
  type RenameFolderInput,
} from './action-schemas';
import { copyFolderTree, orderCopiedFolderTree } from './folder-copy';
import { getDescendantFolderIds } from './folder-tree';
import { hydrateFolders } from './hydration';
import {
  toDocumentFolder,
  type DocumentFolder,
  type DocumentMutationResult,
  type FolderResult,
} from './types';
import { documentWriteFailure, revalidateDocuments } from './write-support';

export async function getDocumentFolderOptions(): Promise<ActionResult<{ folders: DocumentFolder[] }>> {
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const { data, error, overflow } = await readAllRows(
    (from, to) =>
      auth.context.admin
        .from('document_folders')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .is('deleted_at', null)
        .order('name')
        .order('id')
        .range(from, to),
    { cap: LIST_ROW_CAP },
  );
  if (error || overflow) {
    logError('Failed to load document folder options', error);
    return { success: false, error: 'folders_failed' };
  }

  try {
    return {
      success: true,
      folders: await hydrateFolders(auth.context.admin, data),
    };
  } catch (hydrationError) {
    logError('Failed to hydrate document folder options', hydrationError);
    return { success: false, error: 'folders_failed' };
  }
}

export async function createDocumentFolder(rawInput: CreateFolderInput): Promise<FolderResult> {
  const input = parseActionInput(createFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const name = input.name.trim();
  if (!name) {
    return { success: false, error: 'name_required' };
  }

  const folderCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.parentFolderId);
  if (!folderCheck.success) return folderCheck;

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .insert({
      organization_id: auth.context.orgId,
      parent_folder_id: input.parentFolderId || null,
      name,
      created_by: auth.context.userId,
    })
    .select('*')
    .single();

  if (error || !data) {
    logError('Failed to create document folder', error);
    return { success: false, error: 'create_failed' };
  }

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(data) };
}

export async function renameDocumentFolder(rawInput: RenameFolderInput): Promise<FolderResult> {
  const input = parseActionInput(renameFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const name = input.name.trim();
  if (!name) {
    return { success: false, error: 'name_required' };
  }

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .update({ name })
    .eq('id', input.folderId)
    .eq('organization_id', auth.context.orgId)
    .is('deleted_at', null)
    .select('*')
    .single();

  if (error || !data) {
    logError('Failed to rename document folder', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(data) };
}

export async function moveDocumentFolder(rawInput: MoveFolderInput): Promise<FolderResult> {
  const input = parseActionInput(moveFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  if (input.parentFolderId === input.folderId) {
    return { success: false, error: 'invalid_target' };
  }

  const found = await getFolderById(auth.context.admin, auth.context.orgId, input.folderId);
  if (!found.success) return found;
  const { folder } = found;

  if ((folder.parent_folder_id ?? null) === (input.parentFolderId ?? null)) {
    return { success: false, error: 'invalid_target' };
  }

  const targetCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.parentFolderId);
  if (!targetCheck.success) return targetCheck;

  const { data: allFolders, error: allFoldersError } = await readCompleteRows(
    (from, to) =>
      auth.context.admin
        .from('document_folders')
        .select('id, parent_folder_id')
        .eq('organization_id', auth.context.orgId)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (allFoldersError) {
    logError('Failed to load the folder tree', allFoldersError);
    return { success: false, error: 'update_failed' };
  }

  const descendantIds = getDescendantFolderIds(
    (allFolders ?? []).map((row) => ({ id: row.id, parentFolderId: row.parent_folder_id })),
    new Set([input.folderId]),
  );

  if (input.parentFolderId && descendantIds.has(input.parentFolderId)) {
    return { success: false, error: 'invalid_target' };
  }

  const { data, error } = await auth.context.admin
    .from('document_folders')
    .update({ parent_folder_id: input.parentFolderId || null })
    .eq('id', input.folderId)
    .eq('organization_id', auth.context.orgId)
    .select('*')
    .single();

  if (error || !data) {
    logError('Failed to move document folder', error);
    return { success: false, error: 'update_failed' };
  }

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(data) };
}

export async function copyDocumentFolder(rawInput: CopyFolderInput): Promise<FolderResult> {
  const input = parseActionInput(copyFolderInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const source = await getFolderById(auth.context.admin, auth.context.orgId, input.folderId);
  if (!source.success) return source;
  const sourceFolder = source.folder;

  const targetCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.targetParentFolderId);
  if (!targetCheck.success) return targetCheck;

  const { data: allFolders, error: allFoldersError } = await readCompleteRows(
    (from, to) =>
      auth.context.admin
        .from('document_folders')
        .select('*')
        .eq('organization_id', auth.context.orgId)
        .is('deleted_at', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (allFoldersError) {
    logError('Failed to load the folder tree', allFoldersError);
    return { success: false, error: 'copy_failed' };
  }

  const { sourceFolderIds, orderedSourceFolders } = orderCopiedFolderTree(allFolders, input.folderId);

  if (input.targetParentFolderId && sourceFolderIds.has(input.targetParentFolderId)) {
    return { success: false, error: 'invalid_target' };
  }

  const copy = await copyFolderTree({
    context: auth.context,
    sourceFolder,
    targetParentFolderId: input.targetParentFolderId,
    sourceFolderIds,
    orderedSourceFolders,
  });
  if (!copy.success) return copy;

  revalidateDocuments();
  return { success: true, folder: toDocumentFolder(copy.rootFolder) };
}

export async function deleteDocumentFolder(rawFolderId: string): Promise<DocumentMutationResult> {
  const folderId = parseActionInput(uuidSchema, rawFolderId);
  if (!folderId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  // One transaction trashes the folder, its subfolders and their documents with the audit events.
  const { error } = await auth.context.admin.rpc('delete_document_folder', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_folder_id: folderId,
  });
  if (error) {
    return documentWriteFailure(
      'Failed to delete document folder',
      error,
      ['folder_not_found'],
      'delete_failed',
    );
  }

  revalidateDocuments();
  return { success: true };
}
