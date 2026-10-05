'use client';

import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

import type { DocumentLibraryTableItem, DocumentTableItemSelection } from './document-library-table-items';

type SelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
} | null;

type SelectionBoxStyle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Rectangle = { left: number; top: number; right: number; bottom: number };

function getBoxStyle(selectionBox: SelectionBox): SelectionBoxStyle | null {
  if (!selectionBox || !selectionBox.isDragging) return null;

  const left = Math.min(selectionBox.startX, selectionBox.currentX);
  const top = Math.min(selectionBox.startY, selectionBox.currentY);
  const width = Math.abs(selectionBox.currentX - selectionBox.startX);
  const height = Math.abs(selectionBox.currentY - selectionBox.startY);

  return { left, top, width, height };
}

function intersects(first: Rectangle, second: Rectangle): boolean {
  return (
    first.left <= second.right &&
    first.right >= second.left &&
    first.top <= second.bottom &&
    first.bottom >= second.top
  );
}

function shouldIgnorePointerDown(event: ReactPointerEvent<HTMLDivElement>): boolean {
  const target = event.target as HTMLElement | null;
  return (
    event.button !== 0 ||
    !target ||
    Boolean(target.closest('[data-table-interactive="true"]')) ||
    Boolean(target.closest('thead')) ||
    Boolean(target.closest('tr')) ||
    Boolean(target.closest('button, a, input, textarea, select, [role="menuitem"]'))
  );
}

type RectangleSelectionOptions = {
  tableContainerRef: RefObject<HTMLDivElement | null>;
  rowRefs: RefObject<Map<string, HTMLTableRowElement>>;
  /** Shared with the row drag: a finished drag must not count as a row click. */
  suppressClickRef: RefObject<boolean>;
  sortedItems: DocumentLibraryTableItem[];
  onRectangleSelectionChange: (selection: DocumentTableItemSelection) => void;
  onRectangleSelectionComplete: () => void;
};

type RectangleSelection = {
  selectionBoxStyle: SelectionBoxStyle | null;
  handlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handlePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
};

/** Rubber-band selection: dragging over empty table space selects the rows it crosses. */
export function useDocumentLibraryTableRectangleSelection({
  tableContainerRef,
  rowRefs,
  suppressClickRef,
  sortedItems,
  onRectangleSelectionChange,
  onRectangleSelectionComplete,
}: RectangleSelectionOptions): RectangleSelection {
  const [selectionBox, setSelectionBox] = useState<SelectionBox>(null);

  function updateRectangleSelection(nextBox: SelectionBox): void {
    const container = tableContainerRef.current;
    if (!container || !nextBox) return;

    const selectionRect = {
      left: Math.min(nextBox.startX, nextBox.currentX),
      top: Math.min(nextBox.startY, nextBox.currentY),
      right: Math.max(nextBox.startX, nextBox.currentX),
      bottom: Math.max(nextBox.startY, nextBox.currentY),
    };

    const nextFolderIds = new Set<string>();
    const nextDocumentIds = new Set<string>();
    const containerRect = container.getBoundingClientRect();

    for (const item of sortedItems) {
      const row = rowRefs.current.get(item.key);
      if (!row) continue;

      const rowRect = row.getBoundingClientRect();
      const relativeRowRect = {
        left: 0,
        top: rowRect.top - containerRect.top + container.scrollTop,
        right: container.scrollWidth,
        bottom: rowRect.bottom - containerRect.top + container.scrollTop,
      };

      if (!intersects(selectionRect, relativeRowRect)) continue;

      if (item.kind === 'folder') {
        nextFolderIds.add(item.folder.id);
      } else {
        nextDocumentIds.add(item.document.id);
      }
    }

    onRectangleSelectionChange({
      folderIds: nextFolderIds,
      documentIds: nextDocumentIds,
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (shouldIgnorePointerDown(event)) return;

    const container = tableContainerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const startX = event.clientX - containerRect.left + container.scrollLeft;
    const startY = event.clientY - containerRect.top + container.scrollTop;

    suppressClickRef.current = false;
    event.preventDefault();
    container.setPointerCapture(event.pointerId);
    setSelectionBox({
      startX,
      startY,
      currentX: startX,
      currentY: startY,
      isDragging: false,
    });
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!selectionBox) return;

    const container = tableContainerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const currentX = event.clientX - containerRect.left + container.scrollLeft;
    const currentY = event.clientY - containerRect.top + container.scrollTop;
    const isDragging =
      selectionBox.isDragging ||
      Math.abs(currentX - selectionBox.startX) > 4 ||
      Math.abs(currentY - selectionBox.startY) > 4;
    const nextBox = {
      ...selectionBox,
      currentX,
      currentY,
      isDragging,
    };

    if (isDragging) {
      suppressClickRef.current = true;
      window.getSelection()?.removeAllRanges();
      updateRectangleSelection(nextBox);
    }

    setSelectionBox(nextBox);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    const container = tableContainerRef.current;
    if (container?.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }

    if (suppressClickRef.current) {
      onRectangleSelectionComplete();
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }

    setSelectionBox(null);
  }

  return {
    selectionBoxStyle: getBoxStyle(selectionBox),
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
