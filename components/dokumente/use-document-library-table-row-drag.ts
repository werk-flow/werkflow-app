'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import {
  isTableItemSelected,
  type DocumentLibraryTableItem,
  type DocumentTableDragSelection,
  type DocumentTableItemSelection,
} from './document-library-table-items';

type PendingRowDrag = {
  item: DocumentLibraryTableItem;
  selection: DocumentTableDragSelection;
  pointerId: number;
  startX: number;
  startY: number;
  isActive: boolean;
};

type PointerDropTarget =
  | { kind: 'folder'; folderId: string | null; scope: 'breadcrumb' | 'table' }
  | { kind: 'trash' }
  | null;

function startDocumentDragState(): void {
  document.body.style.userSelect = 'none';
}

function clearDocumentDragState(): void {
  document.body.style.userSelect = '';
}

function getPointerDropTarget(
  clientX: number,
  clientY: number,
  selection: DocumentTableDragSelection,
  canDropSelectionIntoFolder: RowDragOptions['canDropSelectionIntoFolder'],
): PointerDropTarget {
  const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  if (!element) return null;

  if (element.closest('[data-document-trash-drop="true"]')) {
    return { kind: 'trash' };
  }

  const breadcrumbTarget = element.closest<HTMLElement>('[data-document-breadcrumb-folder-drop-id]');
  if (breadcrumbTarget) {
    const rawFolderId = breadcrumbTarget.dataset.documentBreadcrumbFolderDropId;
    const folderId = rawFolderId === 'root' ? null : rawFolderId || null;
    return canDropSelectionIntoFolder(selection, folderId)
      ? { kind: 'folder', folderId, scope: 'breadcrumb' }
      : null;
  }

  const tableFolderTarget = element.closest<HTMLElement>('[data-document-table-folder-drop-id]');
  if (tableFolderTarget) {
    const folderId = tableFolderTarget.dataset.documentTableFolderDropId ?? null;
    return folderId && canDropSelectionIntoFolder(selection, folderId)
      ? { kind: 'folder', folderId, scope: 'table' }
      : null;
  }

  return null;
}

type RowDragOptions = {
  /** Shared with the rectangle selection: a finished drag must not count as a row click. */
  suppressClickRef: RefObject<boolean>;
  selection: DocumentTableItemSelection;
  onDragSelectionStart: (selection: DocumentTableDragSelection) => void;
  onDragSelectionEnd: () => void;
  onMoveItemsToFolder: (input: {
    selection: DocumentTableDragSelection;
    targetFolderId: string | null;
  }) => void;
  onMoveItemsToTrash: (selection: DocumentTableDragSelection) => void;
  onPointerDropTargetChange: (
    target: { kind: 'folder'; folderId: string | null } | { kind: 'trash' } | null,
  ) => void;
  canDropSelectionIntoFolder: (
    selection: DocumentTableDragSelection,
    targetFolderId: string | null,
  ) => boolean;
};

type RowDrag = {
  draggedItem: DocumentLibraryTableItem | null;
  draggedSelection: DocumentTableDragSelection | null;
  dragTargetFolderId: string | null;
  dragPosition: { x: number; y: number } | null;
  handleRowPointerDown: (
    event: ReactPointerEvent<HTMLTableRowElement>,
    item: DocumentLibraryTableItem,
  ) => void;
};

/**
 * Pointer drag of table rows onto a folder row, a breadcrumb folder or the
 * trash. The drag starts after 4px of movement and carries the whole selection
 * when the grabbed row is part of it.
 */
export function useDocumentLibraryTableRowDrag({
  suppressClickRef,
  selection: selectedItems,
  onDragSelectionStart,
  onDragSelectionEnd,
  onMoveItemsToFolder,
  onMoveItemsToTrash,
  onPointerDropTargetChange,
  canDropSelectionIntoFolder,
}: RowDragOptions): RowDrag {
  const pendingRowDragRef = useRef<PendingRowDrag | null>(null);
  const [draggedItem, setDraggedItem] = useState<DocumentLibraryTableItem | null>(null);
  const [draggedSelection, setDraggedSelection] = useState<DocumentTableDragSelection | null>(null);
  const [dragTargetFolderId, setDragTargetFolderId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      pendingRowDragRef.current = null;
      clearDocumentDragState();
    };
  }, []);

  function buildDragSelection(item: DocumentLibraryTableItem): DocumentTableDragSelection {
    return isTableItemSelected(item, selectedItems)
      ? {
          folderIds: Array.from(selectedItems.folderIds),
          documentIds: Array.from(selectedItems.documentIds),
        }
      : {
          folderIds: item.kind === 'folder' ? [item.folder.id] : [],
          documentIds: item.kind === 'document' ? [item.document.id] : [],
        };
  }

  function clearPointerDrag(): void {
    pendingRowDragRef.current = null;
    setDraggedItem(null);
    setDraggedSelection(null);
    setDragTargetFolderId(null);
    setDragPosition(null);
    onPointerDropTargetChange(null);
    onDragSelectionEnd();
    clearDocumentDragState();
  }

  function updatePointerDropTarget(
    clientX: number,
    clientY: number,
    selection: DocumentTableDragSelection,
  ): void {
    const target = getPointerDropTarget(clientX, clientY, selection, canDropSelectionIntoFolder);
    setDragTargetFolderId(
      target?.kind === 'folder' && target.scope === 'table' && target.folderId ? target.folderId : null,
    );
    onPointerDropTargetChange(
      target?.kind === 'trash'
        ? { kind: 'trash' }
        : target?.kind === 'folder' && target.scope === 'breadcrumb'
          ? { kind: 'folder', folderId: target.folderId }
          : null,
    );
  }

  function startPointerDrag(pendingDrag: PendingRowDrag, clientX: number, clientY: number): void {
    suppressClickRef.current = true;
    window.getSelection()?.removeAllRanges();
    setDraggedItem(pendingDrag.item);
    setDraggedSelection(pendingDrag.selection);
    setDragPosition({ x: clientX, y: clientY });
    onDragSelectionStart(pendingDrag.selection);
    startDocumentDragState();
    updatePointerDropTarget(clientX, clientY, pendingDrag.selection);
  }

  function handleRowPointerDown(
    event: ReactPointerEvent<HTMLTableRowElement>,
    item: DocumentLibraryTableItem,
  ): void {
    const target = event.target as HTMLElement | null;
    if (
      event.button !== 0 ||
      !target ||
      target.closest('[data-table-interactive="true"]') ||
      target.closest('button, a, input, textarea, select, [role="menuitem"]')
    ) {
      return;
    }

    pendingRowDragRef.current = {
      item,
      selection: buildDragSelection(item),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isActive: false,
    };
  }

  function handleWindowPointerMove(event: PointerEvent): void {
    const pendingDrag = pendingRowDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) return;

    const movedFarEnough =
      Math.abs(event.clientX - pendingDrag.startX) > 4 || Math.abs(event.clientY - pendingDrag.startY) > 4;

    if (!pendingDrag.isActive && !movedFarEnough) return;

    event.preventDefault();

    if (!pendingDrag.isActive) {
      pendingDrag.isActive = true;
      startPointerDrag(pendingDrag, event.clientX, event.clientY);
      return;
    }

    setDragPosition({ x: event.clientX, y: event.clientY });
    updatePointerDropTarget(event.clientX, event.clientY, pendingDrag.selection);
  }

  function handleWindowPointerUp(event: PointerEvent): void {
    const pendingDrag = pendingRowDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) return;

    const dropTarget = pendingDrag.isActive
      ? getPointerDropTarget(event.clientX, event.clientY, pendingDrag.selection, canDropSelectionIntoFolder)
      : null;

    if (dropTarget?.kind === 'trash') {
      onMoveItemsToTrash(pendingDrag.selection);
    } else if (dropTarget?.kind === 'folder') {
      onMoveItemsToFolder({
        selection: pendingDrag.selection,
        targetFolderId: dropTarget.folderId,
      });
    }

    clearPointerDrag();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }

  function handleWindowPointerCancel(): void {
    clearPointerDrag();
    suppressClickRef.current = false;
  }

  useEffect(() => {
    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
    };
  });

  return {
    draggedItem,
    draggedSelection,
    dragTargetFolderId,
    dragPosition,
    handleRowPointerDown,
  };
}
