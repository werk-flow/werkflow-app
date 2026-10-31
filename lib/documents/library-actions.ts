'use server';

import { randomUUID } from 'crypto';
import { loggedRead } from '@/lib/data/read-request-cache';
import { entityIdPageSchema } from '@/lib/jobs/list-page';
import { logError } from '@/lib/logging';
import { copyStorageObject, discardStorageObjects } from '@/lib/storage/r2';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { LIST_PAGE_SIZE, parseListPage } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import {
  ensureFolder,
  getAuthorizedDocument,
  getAuthorizedDocumentContext,
  getDeletedDocumentForManager,
  getFolderById,
  requireManager,
} from './access';
import {
  copyDocumentInputSchema,
  documentLibraryInputSchema,
  INVALID_INPUT,
  moveDocumentInputSchema,
  parseActionInput,
  renameDocumentInputSchema,
  updateDocumentCategoryInputSchema,
  type CopyDocumentInput,
  type DocumentLibraryInput,
  type MoveDocumentInput,
  type RenameDocumentInput,
  type UpdateDocumentCategoryInput,
} from './action-schemas';
import {
  documentRowsFromOrdinaryView,
  hydrateDocuments,
  hydrateFolders,
  hydrateWrittenDocument,
} from './hydration';
import { getCopyDisplayName } from './names';
import { getFolderBreadcrumbs, readOrdinaryDocumentsInOrder } from './reads';
import { buildDocumentStoragePath } from './storage-path';
import type { DocumentLibraryResult, DocumentMutationResult, DocumentResult } from './types';
import { documentWriteFailure, getAvailableDisplayName, revalidateDocuments } from './write-support';

export async function getDocumentLibrary(
  rawInput: DocumentLibraryInput = {},
): Promise<DocumentLibraryResult> {
  const input = parseActionInput(documentLibraryInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;
  const { context } = auth;
  const manager = requireManager(context);
  if (!manager.success) return manager;
  const folderId = input.folderId ?? null;
  const view = input.view ?? 'folders';
  const sort = input.sort ?? 'name';
  const page = parseListPage(input.page);
  const folderPage = parseListPage(input.folderPage);
  if (view !== 'trash') {
    const folderCheck = await ensureFolder(context.admin, context.orgId, folderId);
    if (!folderCheck.success) return folderCheck;
  }
  const isFolderView = view === 'folders' || Boolean(folderId);
  let foldersQuery = context.admin
    .from('document_folders')
    .select('*', { count: 'exact' })
    .eq('organization_id', context.orgId)
    .is('deleted_at', null)
    .order('name')
    .order('id');
  foldersQuery = folderId
    ? foldersQuery.eq('parent_folder_id', folderId)
    : foldersQuery.is('parent_folder_id', null);
  const [selection, foldersResult] = await Promise.all([
    context.admin.rpc('list_document_page', {
      p_organization_id: context.orgId,
      p_filters: {
        folderId,
        view,
        sort,
        searchQuery: (input.searchQuery ?? '').trim().slice(0, 250),
        category: input.category ?? 'all',
        linkFilter: input.linkFilter ?? 'all',
        page,
        pageSize: LIST_PAGE_SIZE,
      },
    }),
    isFolderView && view !== 'trash'
      ? foldersQuery.range((folderPage - 1) * LIST_PAGE_SIZE, folderPage * LIST_PAGE_SIZE - 1)
      : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  const selected = entityIdPageSchema.safeParse(selection.data);
  if (selection.error || !selected.success || foldersResult.error)
    return { success: false, error: 'documents_failed' };
  const rows = await readOrdinaryDocumentsInOrder(
    context,
    selected.data.ids,
    'getDocumentLibrary: read failed',
  );
  if (!rows) return { success: false, error: 'documents_failed' };
  try {
    const [breadcrumbs, folders, documents] = await Promise.all([
      view === 'trash' ? [] : getFolderBreadcrumbs({ admin: context.admin, orgId: context.orgId, folderId }),
      hydrateFolders(context.admin, foldersResult.data),
      hydrateDocuments(context.admin, documentRowsFromOrdinaryView(rows)),
    ]);
    return {
      success: true,
      page,
      total: selected.data.total,
      folderPage,
      folderTotal: foldersResult.count ?? 0,
      breadcrumbs,
      folders,
      documents,
    };
  } catch (error) {
    logError('Error hydrating the document library', error);
    return { success: false, error: 'documents_failed' };
  }
}

export async function renameDocument(rawInput: RenameDocumentInput): Promise<DocumentResult> {
  const input = parseActionInput(renameDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const displayName = input.displayName.trim();
  if (!displayName) {
    return { success: false, error: 'name_required' };
  }

  const { data, error } = await auth.context.admin.rpc('rename_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_display_name: displayName,
  });
  if (error || !data) {
    return documentWriteFailure('Failed to rename document', error, ['document_not_found'], 'update_failed');
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function updateDocumentCategory(rawInput: UpdateDocumentCategoryInput): Promise<DocumentResult> {
  const input = parseActionInput(updateDocumentCategoryInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const { data, error } = await auth.context.admin.rpc('update_document_category', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_category: input.category,
  });
  if (error || !data) {
    return documentWriteFailure(
      'Failed to update document category',
      error,
      ['document_not_found'],
      'update_failed',
    );
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function moveDocument(rawInput: MoveDocumentInput): Promise<DocumentResult> {
  const input = parseActionInput(moveDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: input.folderId,
    preferredName: existing.document.display_name,
  });

  // The function refuses a protected personnel document, the same folder and a missing target folder.
  const { data, error } = await auth.context.admin.rpc(
    'move_document',
    rpcArgs('move_document', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_document_id: existing.document.id,
      p_folder_id: input.folderId || null,
      p_display_name: displayName,
    }),
  );
  if (error || !data) {
    return documentWriteFailure(
      'Failed to move document',
      error,
      ['document_not_found', 'protected_document_boundary', 'invalid_target', 'folder_not_found'],
      'update_failed',
    );
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function copyDocument(rawInput: CopyDocumentInput): Promise<DocumentResult> {
  const input = parseActionInput(copyDocumentInputSchema, rawInput);
  if (!input) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, input.documentId);
  if (!existing.success) return existing;

  const { data: protectedDocument, error: protectedDocumentError } = await loggedRead(
    'copyDocument: personnel_documents read failed',
    auth.context.admin
      .from('personnel_documents')
      .select('id')
      .eq('organization_id', auth.context.orgId)
      .eq('document_id', existing.document.id)
      .maybeSingle(),
  );
  if (protectedDocumentError) return { success: false, error: 'load_failed' };
  if (protectedDocument) {
    return { success: false, error: 'protected_document_boundary' };
  }

  const folderCheck = await ensureFolder(auth.context.admin, auth.context.orgId, input.targetFolderId);
  if (!folderCheck.success) return folderCheck;

  const documentId = randomUUID();
  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: input.targetFolderId,
    preferredName: getCopyDisplayName(existing.document.display_name),
  });
  const storagePath = buildDocumentStoragePath({
    organizationId: auth.context.orgId,
    documentId,
    fileName: existing.document.original_file_name,
  });

  try {
    await copyStorageObject({
      organizationId: auth.context.orgId,
      sourcePath: existing.document.storage_path,
      targetPath: storagePath,
      contentType: existing.document.mime_type,
    });
  } catch (storageCopyError) {
    logError('Failed to copy document storage object', storageCopyError);
    return { success: false, error: 'copy_failed' };
  }

  // The object exists first; a refused registration discards it.
  const { data, error } = await auth.context.admin.rpc(
    'copy_document',
    rpcArgs('copy_document', {
      p_actor_id: auth.context.userId,
      p_organization_id: auth.context.orgId,
      p_source_document_id: existing.document.id,
      p_document_id: documentId,
      p_folder_id: input.targetFolderId || null,
      p_storage_path: storagePath,
      p_display_name: displayName,
    }),
  );
  if (error || !data) {
    await discardStorageObjects({ organizationId: auth.context.orgId, paths: [storagePath] });
    return documentWriteFailure(
      'Failed to create copied document metadata',
      error,
      ['document_not_found', 'protected_document_boundary', 'folder_not_found'],
      'copy_failed',
    );
  }

  revalidateDocuments();
  return hydrateWrittenDocument(auth.context.admin, data);
}

export async function deleteDocument(rawDocumentId: string): Promise<DocumentMutationResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const manager = requireManager(auth.context);
  if (!manager.success) return manager;

  const existing = await getAuthorizedDocument(auth.context, documentId);
  if (!existing.success) return existing;

  const { error } = await auth.context.admin.rpc('trash_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
  });
  if (error) {
    return documentWriteFailure(
      'Failed to delete document metadata',
      error,
      ['document_not_found'],
      'delete_failed',
    );
  }

  revalidateDocuments();
  return { success: true };
}

export async function restoreDocument(rawDocumentId: string): Promise<DocumentMutationResult> {
  const documentId = parseActionInput(uuidSchema, rawDocumentId);
  if (!documentId) return INVALID_INPUT;
  const auth = await getAuthorizedDocumentContext();
  if (!auth.success) return auth;

  const existing = await getDeletedDocumentForManager(auth.context, documentId);
  if (!existing.success) return existing;

  let restoreFolderId = existing.document.folder_id;
  if (restoreFolderId) {
    // A deleted folder restores the document to the library root; a failed read restores nothing.
    const folder = await getFolderById(auth.context.admin, auth.context.orgId, restoreFolderId);
    if (!folder.success && folder.error !== 'folder_not_found') return folder;
    restoreFolderId = folder.success ? restoreFolderId : null;
  }

  const displayName = await getAvailableDisplayName({
    admin: auth.context.admin,
    orgId: auth.context.orgId,
    folderId: restoreFolderId,
    preferredName: existing.document.display_name,
  });

  const { error } = await auth.context.admin.rpc('restore_document', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_document_id: existing.document.id,
    p_display_name: displayName,
  });
  if (error) {
    return documentWriteFailure(
      'Failed to restore document',
      error,
      ['document_not_found'],
      'restore_failed',
    );
  }

  revalidateDocuments();
  return { success: true };
}
