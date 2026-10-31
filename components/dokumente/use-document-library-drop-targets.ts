'use client';

import { useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';

import { moveDocumentFolder } from '@/lib/documents/folder-actions';
import { moveDocument } from '@/lib/documents/library-actions';
import type { DocumentFolder, DocumentLibraryView, OrganizationDocument } from '@/lib/documents/types';
import { hasInternalRowDrag, readInternalRowDragSelection } from './document-drop-entries';
import { canDropFolderIdsIntoFolder } from '@/lib/documents/folder-tree';
import type { DocumentTableDragSelection } from './document-library-table';
import type { DocumentLibraryMutations } from './use-document-library-mutations';
import type { DocumentLibrarySelection } from './use-document-library-selection';

type PointerDropTarget = { kind: 'folder'; folderId: string | null } | { kind: 'trash' } | null;

/** Moves the rows one by one; a failed document move brings its row back. */
async function moveItemsIntoFolder({
  mutations,
  documentsToMove,
  foldersToMove,
  targetFolderId,
}: {
  mutations: DocumentLibraryMutations;
  documentsToMove: OrganizationDocument[];
  foldersToMove: DocumentFolder[];
  targetFolderId: string | null;
}): Promise<void> {
  const { documentList, runMutation, showFeedback } = mutations;
  let failedCount = 0;

  for (const document of documentsToMove) {
    const succeeded = await runMutation(document.id, () =>
      moveDocument({
        documentId: document.id,
        folderId: targetFolderId,
      }),
    );
    if (succeeded) continue;
    failedCount++;
    documentList.rollback(document.id);
  }

  for (const folder of foldersToMove) {
    const succeeded = await runMutation(folder.id, () =>
      moveDocumentFolder({
        folderId: folder.id,
        parentFolderId: targetFolderId,
      }),
    );
    if (!succeeded) failedCount++;
  }

  if (failedCount > 0) {
    showFeedback(
      'error',
      failedCount === 1
        ? '1 Eintrag konnte nicht verschoben werden.'
        : `${failedCount} Einträge konnten nicht verschoben werden.`,
    );
  } else {
    showFeedback('success', 'Auswahl wurde verschoben.');
  }
}

type DraggedRowsScope = {
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
  visibleView: DocumentLibraryView;
  isTrashView: boolean;
  mutations: DocumentLibraryMutations;
  selection: DocumentLibrarySelection;
};

function getSelectionItems(
  { documents, folders }: Pick<DraggedRowsScope, 'documents' | 'folders'>,
  dragSelection: DocumentTableDragSelection,
): {
  documentsToUse: OrganizationDocument[];
  foldersToUse: DocumentFolder[];
} {
  return {
    documentsToUse: documents.filter((document) => dragSelection.documentIds.includes(document.id)),
    foldersToUse: folders.filter((folder) => dragSelection.folderIds.includes(folder.id)),
  };
}

function moveSelectionIntoFolder(
  scope: DraggedRowsScope,
  dragSelection: DocumentTableDragSelection,
  targetFolderId: string | null,
): void {
  const { visibleView, isTrashView, mutations, selection } = scope;
  if (isTrashView) return;
  const { documentsToUse, foldersToUse } = getSelectionItems(scope, dragSelection);
  const filteredFoldersToMove = foldersToUse.filter((folder) => folder.id !== targetFolderId);

  if (documentsToUse.length === 0 && filteredFoldersToMove.length === 0) return;

  // A dropped document leaves the current folder at once (folder view
  // only: in "Alle Dateien" it stays listed); a failed move brings it back.
  const leavesCurrentList = visibleView === 'folders';
  if (leavesCurrentList) {
    for (const document of documentsToUse) {
      mutations.documentList.remove(document.id);
    }
  }
  selection.clearSelection();

  void moveItemsIntoFolder({
    mutations,
    documentsToMove: documentsToUse,
    foldersToMove: filteredFoldersToMove,
    targetFolderId,
  });
}

type DocumentLibraryDropTargetsOptions = {
  documents: OrganizationDocument[];
  folders: DocumentFolder[];
  allFolders: DocumentFolder[];
  currentFolderId: string | null;
  visibleView: DocumentLibraryView;
  isTrashView: boolean;
  mutations: DocumentLibraryMutations;
  selection: DocumentLibrarySelection;
  onDeleteSelection: (input: {
    documentsToDelete: OrganizationDocument[];
    foldersToDelete: DocumentFolder[];
  }) => void;
};

type NativeRowDropOptions = {
  draggedTableSelection: DocumentTableDragSelection | null;
  canDropSelectionIntoFolder: (
    dragSelection: DocumentTableDragSelection,
    targetFolderId: string | null,
  ) => boolean;
  setIsTrashDragOver: Dispatch<SetStateAction<boolean>>;
  setBreadcrumbDropTargetId: Dispatch<SetStateAction<string | 'root' | null>>;
  onMoveItemsToTrash: (dragSelection: DocumentTableDragSelection) => void;
  onMoveItemsIntoFolder: (dragSelection: DocumentTableDragSelection, targetFolderId: string | null) => void;
};

/** The native drag and drop of rows onto the trash button or a breadcrumb folder. */
function createNativeRowDropHandlers({
  draggedTableSelection,
  canDropSelectionIntoFolder,
  setIsTrashDragOver,
  setBreadcrumbDropTargetId,
  onMoveItemsToTrash,
  onMoveItemsIntoFolder,
}: NativeRowDropOptions) {
  function handleTrashDrop(event: DragEvent<HTMLButtonElement>) {
    if (!hasInternalRowDrag(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();
    setIsTrashDragOver(false);

    const dragSelection = readInternalRowDragSelection(event.dataTransfer, draggedTableSelection);
    if (!dragSelection) return;

    onMoveItemsToTrash(dragSelection);
  }

  function handleBreadcrumbDragOver(event: DragEvent<HTMLElement>, targetFolderId: string | null) {
    if (!hasInternalRowDrag(event.dataTransfer)) return;
    event.preventDefault();

    const dragSelection =
      readInternalRowDragSelection(event.dataTransfer, draggedTableSelection) ?? draggedTableSelection;
    if (!dragSelection || !canDropSelectionIntoFolder(dragSelection, targetFolderId)) {
      event.dataTransfer.dropEffect = 'none';
      setBreadcrumbDropTargetId(null);
      return;
    }

    event.dataTransfer.dropEffect = 'move';
    setBreadcrumbDropTargetId(targetFolderId ?? 'root');
  }

  function handleBreadcrumbDrop(event: DragEvent<HTMLElement>, targetFolderId: string | null) {
    if (!hasInternalRowDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    setBreadcrumbDropTargetId(null);

    const dragSelection =
      readInternalRowDragSelection(event.dataTransfer, draggedTableSelection) ?? draggedTableSelection;
    if (!dragSelection || !canDropSelectionIntoFolder(dragSelection, targetFolderId)) {
      return;
    }

    onMoveItemsIntoFolder(dragSelection, targetFolderId);
  }

  return { handleTrashDrop, handleBreadcrumbDragOver, handleBreadcrumbDrop };
}

/** The dragged rows and the trash and breadcrumb highlights they light up. */
function useDocumentLibraryDropHighlights() {
  const [draggedTableSelection, setDraggedTableSelection] = useState<DocumentTableDragSelection | null>(null);
  const [isTrashDragOver, setIsTrashDragOver] = useState(false);
  const [breadcrumbDropTargetId, setBreadcrumbDropTargetId] = useState<string | 'root' | null>(null);

  function handlePointerDropTargetChange(target: PointerDropTarget) {
    setIsTrashDragOver(target?.kind === 'trash');
    setBreadcrumbDropTargetId(target?.kind === 'folder' ? (target.folderId ?? 'root') : null);
  }

  function handleDragSelectionEnd() {
    setDraggedTableSelection(null);
    setIsTrashDragOver(false);
    setBreadcrumbDropTargetId(null);
  }

  return {
    draggedTableSelection,
    isTrashDragOver,
    setIsTrashDragOver,
    breadcrumbDropTargetId,
    setBreadcrumbDropTargetId,
    setDraggedTableSelection,
    handlePointerDropTargetChange,
    handleDragSelectionEnd,
  };
}

export type DocumentLibraryDropTargets = ReturnType<typeof useDocumentLibraryDropTargets>;

/**
 * Dragging library rows onto a folder row, a breadcrumb or the trash button:
 * the drop-target highlights, the drop rules and the optimistic move.
 */
export function useDocumentLibraryDropTargets({
  documents,
  folders,
  allFolders,
  currentFolderId,
  visibleView,
  isTrashView,
  mutations,
  selection,
  onDeleteSelection,
}: DocumentLibraryDropTargetsOptions) {
  const draggedRowsScope: DraggedRowsScope = {
    documents,
    folders,
    visibleView,
    isTrashView,
    mutations,
    selection,
  };
  const { draggedTableSelection, ...highlights } = useDocumentLibraryDropHighlights();

  /** The current folder is never a target: its items are already there. */
  function canDropSelectionIntoFolder(
    dragSelection: DocumentTableDragSelection,
    targetFolderId: string | null,
  ): boolean {
    if (targetFolderId === currentFolderId) return false;
    return canDropFolderIdsIntoFolder({
      allFolders,
      folderIds: dragSelection.folderIds,
      targetFolderId,
    });
  }

  function handleMoveItemsToFolder({
    selection: dragSelection,
    targetFolderId,
  }: {
    selection: DocumentTableDragSelection;
    targetFolderId: string | null;
  }) {
    if (!canDropSelectionIntoFolder(dragSelection, targetFolderId)) return;
    moveSelectionIntoFolder(draggedRowsScope, dragSelection, targetFolderId);
  }

  function handleMoveItemsToTrash(dragSelection: DocumentTableDragSelection) {
    // Rows in the trash view are already trashed.
    if (isTrashView) return;
    const { documentsToUse, foldersToUse } = getSelectionItems(draggedRowsScope, dragSelection);
    selection.replaceSelection({
      documentIds: new Set(dragSelection.documentIds),
      folderIds: new Set(dragSelection.folderIds),
    });
    onDeleteSelection({
      documentsToDelete: documentsToUse,
      foldersToDelete: foldersToUse,
    });
  }

  const nativeRowDrop = createNativeRowDropHandlers({
    draggedTableSelection,
    canDropSelectionIntoFolder,
    setIsTrashDragOver: highlights.setIsTrashDragOver,
    setBreadcrumbDropTargetId: highlights.setBreadcrumbDropTargetId,
    onMoveItemsToTrash: handleMoveItemsToTrash,
    onMoveItemsIntoFolder: (dragSelection, targetFolderId) =>
      moveSelectionIntoFolder(draggedRowsScope, dragSelection, targetFolderId),
  });

  return {
    ...highlights,
    canDropSelectionIntoFolder,
    handleMoveItemsToFolder,
    handleMoveItemsToTrash,
    ...nativeRowDrop,
  };
}
