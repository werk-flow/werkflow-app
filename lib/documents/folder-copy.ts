import 'server-only';

import { randomUUID } from 'crypto';
import { logError } from '@/lib/logging';
import { copyStorageObject, discardStorageObjects } from '@/lib/storage/r2';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { ActionResult } from '@/lib/action-result';
import type { AuthorizedDocumentContext } from './access';
import { getCopyDisplayName } from './names';
import { buildDocumentStoragePath } from './storage-path';
import type { DocumentFolderRow, DocumentRow } from './types';
import { documentWriteFailure, getAvailableFolderName } from './write-support';

/** The source subtree below the root in breadth-first order, so a parent is copied before its children. */
export function orderCopiedFolderTree(
  allFolders: DocumentFolderRow[],
  sourceRootFolderId: string,
): { sourceFolderIds: Set<string>; orderedSourceFolders: DocumentFolderRow[] } {
  const childFoldersByParent = new Map<string, DocumentFolderRow[]>();
  for (const folder of allFolders) {
    if (!folder.parent_folder_id) continue;
    const siblings = childFoldersByParent.get(folder.parent_folder_id) ?? [];
    siblings.push(folder);
    childFoldersByParent.set(folder.parent_folder_id, siblings);
  }

  const sourceFolderIds = new Set<string>([sourceRootFolderId]);
  const stack = [...(childFoldersByParent.get(sourceRootFolderId) ?? [])];
  const orderedSourceFolders: DocumentFolderRow[] = [];
  for (let folder = stack.shift(); folder !== undefined; folder = stack.shift()) {
    // Two concurrent moves can leave a parent cycle; visit each folder once.
    if (sourceFolderIds.has(folder.id)) continue;
    sourceFolderIds.add(folder.id);
    orderedSourceFolders.push(folder);
    stack.push(...(childFoldersByParent.get(folder.id) ?? []));
  }
  return { sourceFolderIds, orderedSourceFolders };
}

type PlannedFolder = { id: string; parentFolderId: string | null; name: string };

type SourceDocument = Pick<
  DocumentRow,
  'id' | 'folder_id' | 'original_file_name' | 'display_name' | 'storage_path' | 'mime_type'
>;

type PlannedDocument = {
  source: SourceDocument;
  planned: {
    id: string;
    sourceDocumentId: string;
    folderId: string;
    storagePath: string;
    displayName: string;
  };
};

/**
 * The new folders with their ids and names, the root first. A source folder's
 * names are unique, so the copies inside the new folders are too; only the
 * root meets existing siblings. Null when a parent has no planned copy.
 */
async function planFolderCopies({
  context,
  sourceFolder,
  targetParentFolderId,
  orderedSourceFolders,
}: {
  context: AuthorizedDocumentContext;
  sourceFolder: DocumentFolderRow;
  targetParentFolderId: string | null | undefined;
  orderedSourceFolders: DocumentFolderRow[];
}): Promise<{ folders: PlannedFolder[]; folderIdMap: Map<string, string> } | null> {
  const rootFolderId = randomUUID();
  const folderIdMap = new Map([[sourceFolder.id, rootFolderId]]);
  const folders: PlannedFolder[] = [
    {
      id: rootFolderId,
      parentFolderId: targetParentFolderId || null,
      name: await getAvailableFolderName({
        admin: context.admin,
        orgId: context.orgId,
        parentFolderId: targetParentFolderId,
        preferredName: getCopyDisplayName(sourceFolder.name),
      }),
    },
  ];
  for (const sourceChildFolder of orderedSourceFolders) {
    const parentFolderId = sourceChildFolder.parent_folder_id
      ? folderIdMap.get(sourceChildFolder.parent_folder_id)
      : undefined;
    if (!parentFolderId) return null;
    const folderId = randomUUID();
    folderIdMap.set(sourceChildFolder.id, folderId);
    folders.push({ id: folderId, parentFolderId, name: getCopyDisplayName(sourceChildFolder.name) });
  }
  return { folders, folderIdMap };
}

/** Each source document with its planned copy in the new folders; null when its folder has no planned copy. */
function planDocumentCopies(
  organizationId: string,
  sourceDocuments: SourceDocument[],
  folderIdMap: Map<string, string>,
): PlannedDocument[] | null {
  const documents: PlannedDocument[] = [];
  for (const sourceDocument of sourceDocuments) {
    const folderId = sourceDocument.folder_id ? folderIdMap.get(sourceDocument.folder_id) : undefined;
    if (!folderId) return null;
    const documentId = randomUUID();
    documents.push({
      source: sourceDocument,
      planned: {
        id: documentId,
        sourceDocumentId: sourceDocument.id,
        folderId,
        storagePath: buildDocumentStoragePath({
          organizationId,
          documentId,
          fileName: sourceDocument.original_file_name,
        }),
        displayName: getCopyDisplayName(sourceDocument.display_name),
      },
    });
  }
  return documents;
}

/** Copies every planned object; a failed copy discards the ones copied before it and returns null. */
async function copyPlannedObjects(
  organizationId: string,
  documents: PlannedDocument[],
): Promise<string[] | null> {
  const copiedPaths: string[] = [];
  for (const { source, planned } of documents) {
    try {
      await copyStorageObject({
        organizationId,
        sourcePath: source.storage_path,
        targetPath: planned.storagePath,
        contentType: source.mime_type,
      });
    } catch (storageCopyError) {
      logError('Failed to copy document storage object in folder', storageCopyError);
      await discardStorageObjects({ organizationId, paths: copiedPaths });
      return null;
    }
    copiedPaths.push(planned.storagePath);
  }
  return copiedPaths;
}

/**
 * Copies the source folder, its subtree and their documents below the target
 * parent. The copy is planned here: ids, names and storage paths. Every
 * object is copied first; then copy_document_folder writes the folders, the
 * documents and their audit events in one transaction. A refused copy writes
 * no row and discards the copied objects.
 */
export async function copyFolderTree({
  context,
  sourceFolder,
  targetParentFolderId,
  sourceFolderIds,
  orderedSourceFolders,
}: {
  context: AuthorizedDocumentContext;
  sourceFolder: DocumentFolderRow;
  targetParentFolderId: string | null | undefined;
  sourceFolderIds: Set<string>;
  orderedSourceFolders: DocumentFolderRow[];
}): Promise<ActionResult<{ rootFolder: DocumentFolderRow }>> {
  const { data: sourceDocuments, error: sourceDocumentsError } = await readInBatches(
    Array.from(sourceFolderIds),
    (ids) =>
      readCompleteRows(
        (from, to) =>
          context.admin
            .from('documents')
            .select('id, folder_id, original_file_name, display_name, storage_path, mime_type')
            .eq('organization_id', context.orgId)
            .in('folder_id', [...ids])
            .is('deleted_at', null)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
  );
  if (sourceDocumentsError) {
    logError('Failed to load documents for folder copy', sourceDocumentsError);
    return { success: false, error: 'copy_failed' };
  }

  const folderPlan = await planFolderCopies({
    context,
    sourceFolder,
    targetParentFolderId,
    orderedSourceFolders,
  });
  if (!folderPlan) return { success: false, error: 'copy_failed' };
  const documents = planDocumentCopies(context.orgId, sourceDocuments, folderPlan.folderIdMap);
  if (!documents) return { success: false, error: 'copy_failed' };

  const copiedPaths = await copyPlannedObjects(context.orgId, documents);
  if (!copiedPaths) return { success: false, error: 'copy_failed' };

  const { data: rootFolder, error } = await context.admin.rpc(
    'copy_document_folder',
    rpcArgs('copy_document_folder', {
      p_actor_id: context.userId,
      p_organization_id: context.orgId,
      p_source_folder_id: sourceFolder.id,
      p_target_parent_folder_id: targetParentFolderId || null,
      p_folders: folderPlan.folders,
      p_documents: documents.map(({ planned }) => planned),
    }),
  );
  if (error || !rootFolder) {
    await discardStorageObjects({ organizationId: context.orgId, paths: copiedPaths });
    return documentWriteFailure('Failed to copy document folder', error, ['folder_not_found'], 'copy_failed');
  }
  return { success: true, rootFolder };
}
