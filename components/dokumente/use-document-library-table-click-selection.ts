'use client';

import type { MouseEvent, RefObject } from 'react';

import {
  getSelectionWithNearestRange,
  getSingleItemSelection,
  isTableItemSelected,
  type DocumentLibraryTableItem,
  type DocumentTableItemSelection,
} from './document-library-table-items';

type ClickSelectionOptions = {
  /** Set by the rectangle selection and the row drag: their pointer-up must not select. */
  suppressClickRef: RefObject<boolean>;
  sortedItems: DocumentLibraryTableItem[];
  selection: DocumentTableItemSelection;
  onToggleFolderSelection: (folderId: string) => void;
  onToggleDocumentSelection: (documentId: string) => void;
  onRectangleSelectionChange: (selection: DocumentTableItemSelection) => void;
};

type ClickSelection = {
  toggleItemSelection: (item: DocumentLibraryTableItem) => void;
  handleRowSelectionClick: (event: MouseEvent<HTMLTableRowElement>, item: DocumentLibraryTableItem) => void;
};

/**
 * Row click selection: a plain click selects only the row, Ctrl/Cmd adds it,
 * Shift extends the selection to the nearest selected row.
 */
export function useDocumentLibraryTableClickSelection({
  suppressClickRef,
  sortedItems,
  selection,
  onToggleFolderSelection,
  onToggleDocumentSelection,
  onRectangleSelectionChange,
}: ClickSelectionOptions): ClickSelection {
  function toggleItemSelection(item: DocumentLibraryTableItem): void {
    if (item.kind === 'folder') {
      onToggleFolderSelection(item.folder.id);
    } else {
      onToggleDocumentSelection(item.document.id);
    }
  }

  function handleRowSelectionClick(
    event: MouseEvent<HTMLTableRowElement>,
    item: DocumentLibraryTableItem,
  ): void {
    if (suppressClickRef.current || event.detail > 1) return;
    event.stopPropagation();
    const isAdditiveClick = event.ctrlKey || event.metaKey;
    const isRangeClick = event.shiftKey;

    if (isRangeClick) {
      const rangeSelection = getSelectionWithNearestRange(sortedItems, item.key, selection);
      if (rangeSelection) {
        onRectangleSelectionChange(rangeSelection);
        return;
      }
    }

    if (isAdditiveClick) {
      if (!isTableItemSelected(item, selection)) toggleItemSelection(item);
      return;
    }

    onRectangleSelectionChange(getSingleItemSelection(item));
  }

  return { toggleItemSelection, handleRowSelectionClick };
}
