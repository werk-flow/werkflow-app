import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';

/** Pure folder-tree rules of the document library: paths, descendants and move/copy targets. */

export function getFolderPath(
  foldersById: Map<string, DocumentFolder>,
  folderId: string | null,
): DocumentFolder[] {
  if (!folderId) return [];

  const path: DocumentFolder[] = [];
  const visitedFolderIds = new Set<string>();
  let currentFolder = foldersById.get(folderId);

  while (currentFolder && !visitedFolderIds.has(currentFolder.id)) {
    visitedFolderIds.add(currentFolder.id);
    path.unshift(currentFolder);
    currentFolder = currentFolder.parentFolderId ? foldersById.get(currentFolder.parentFolderId) : undefined;
  }

  return path;
}

export function getDescendantFolderIds(
  folders: ReadonlyArray<Pick<DocumentFolder, 'id' | 'parentFolderId'>>,
  folderIds: ReadonlySet<string>,
): Set<string> {
  const childIdsByParent = new Map<string, string[]>();

  for (const folder of folders) {
    if (!folder.parentFolderId) continue;
    const childIds = childIdsByParent.get(folder.parentFolderId) ?? [];
    childIds.push(folder.id);
    childIdsByParent.set(folder.parentFolderId, childIds);
  }

  const descendantIds = new Set<string>();
  const stack = Array.from(folderIds).flatMap((folderId) => childIdsByParent.get(folderId) ?? []);

  while (stack.length > 0) {
    const folderId = stack.pop();
    if (!folderId || descendantIds.has(folderId)) continue;
    descendantIds.add(folderId);
    stack.push(...(childIdsByParent.get(folderId) ?? []));
  }

  return descendantIds;
}

export function getTopLevelSelectedFolders(
  folders: DocumentFolder[],
  allFolders: DocumentFolder[],
): DocumentFolder[] {
  if (folders.length <= 1) return folders;

  const selectedFolderIds = new Set(folders.map((folder) => folder.id));
  const foldersById = new Map(allFolders.map((folder) => [folder.id, folder]));

  return folders.filter((folder) => {
    let parentFolderId = folder.parentFolderId;
    // Two concurrent moves can leave a parent cycle; walk each ancestor once.
    const visitedFolderIds = new Set<string>();

    while (parentFolderId && !visitedFolderIds.has(parentFolderId)) {
      if (selectedFolderIds.has(parentFolderId)) return false;
      visitedFolderIds.add(parentFolderId);
      parentFolderId = foldersById.get(parentFolderId)?.parentFolderId ?? null;
    }

    return true;
  });
}

export function getSourceFolderKey(folderId: string | null): string {
  return folderId ?? 'root';
}

export function getSelectedSourceFolderKeys({
  documents,
  folders,
}: {
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
}): Set<string> {
  return new Set([
    ...documents.map((document) => getSourceFolderKey(document.folderId)),
    ...folders.map((folder) => getSourceFolderKey(folder.parentFolderId)),
  ]);
}

/**
 * The folder a move/copy dialog starts in: the one folder every item shares,
 * the root when the items come from several folders or from the root, and the
 * fallback when there is no item.
 */
export function getSharedSourceFolderId({
  documentsToCheck,
  foldersToCheck,
  fallbackFolderId,
}: {
  documentsToCheck: OrganizationDocument[];
  foldersToCheck: DocumentFolder[];
  fallbackFolderId: string | null;
}): string | null {
  const sourceFolderIds = [
    ...documentsToCheck.map((document) => document.folderId ?? 'root'),
    ...foldersToCheck.map((folder) => folder.parentFolderId ?? 'root'),
  ];

  const firstSourceFolderId = sourceFolderIds[0];
  if (firstSourceFolderId === undefined) return fallbackFolderId;
  const allSameSource = sourceFolderIds.every((sourceFolderId) => sourceFolderId === firstSourceFolderId);

  return allSameSource && firstSourceFolderId !== 'root' ? firstSourceFolderId : null;
}

/** True when the destination is one of the folders or lies inside one of them. */
export function targetContainsSelectedFolder({
  allFolders,
  foldersToProcess,
  destinationFolderId,
}: {
  allFolders: DocumentFolder[];
  foldersToProcess: DocumentFolder[];
  destinationFolderId: string | null;
}): boolean {
  if (!destinationFolderId || foldersToProcess.length === 0) return false;

  const folderIds = new Set(foldersToProcess.map((folder) => folder.id));
  if (folderIds.has(destinationFolderId)) return true;

  return getDescendantFolderIds(allFolders, folderIds).has(destinationFolderId);
}

/** True when at least one item already lives in the destination folder. */
export function targetContainsSelectedItemCurrentLocation({
  documentsToProcess,
  foldersToProcess,
  destinationFolderId,
}: {
  documentsToProcess: OrganizationDocument[];
  foldersToProcess: DocumentFolder[];
  destinationFolderId: string | null;
}): boolean {
  const destinationKey = getSourceFolderKey(destinationFolderId);

  return (
    documentsToProcess.some((document) => getSourceFolderKey(document.folderId) === destinationKey) ||
    foldersToProcess.some((folder) => getSourceFolderKey(folder.parentFolderId) === destinationKey)
  );
}

/** Whether dragged rows may land in a folder: never in themselves or their own subtree. */
export function canDropFolderIdsIntoFolder({
  allFolders,
  folderIds,
  targetFolderId,
}: {
  allFolders: DocumentFolder[];
  folderIds: string[];
  targetFolderId: string | null;
}): boolean {
  if (!targetFolderId) return true;
  if (folderIds.includes(targetFolderId)) return false;

  const descendantFolderIds = getDescendantFolderIds(allFolders, new Set(folderIds));
  return !descendantFolderIds.has(targetFolderId);
}
