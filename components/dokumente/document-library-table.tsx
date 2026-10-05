'use client';

import { useRef, type ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import { DocumentLibraryEmptyState } from './document-library-mobile-list';
import { DocumentLibraryTableDragBadge } from './document-library-table-drag-badge';
import { DOCUMENT_COLUMNS, DocumentLibraryTableHeader } from './document-library-table-header';
import {
  getSingleItemSelection,
  isTableItemSelected,
  type DocumentLibraryTableItem,
  type DocumentTableDragSelection,
  type DocumentTableItemSelection,
} from './document-library-table-items';
import {
  DocumentLibraryTableDocumentRow,
  DocumentLibraryTableFolderRow,
  type DocumentActionHandlers,
  type DocumentLibraryTableRowProps,
  type FolderActionHandlers,
} from './document-library-table-rows';
import { useDocumentLibraryTableClickSelection } from './use-document-library-table-click-selection';
import { useDocumentLibraryTableRectangleSelection } from './use-document-library-table-rectangle-selection';
import { useDocumentLibraryTableRowDrag } from './use-document-library-table-row-drag';
import { useDocumentLibraryTableSort } from './use-document-library-table-sort';

export type { DocumentTableDragSelection } from './document-library-table-items';

type DocumentLibraryTableProps = {
  folders: DocumentFolder[];
  documents: OrganizationDocument[];
  selectedFolderIds: Set<string>;
  selectedDocumentIds: Set<string>;
  isTrashView: boolean;
  searchQuery: string;
  isPending: boolean;
  isItemPending: (itemId: string) => boolean;
  onOpenFolder: (folder: DocumentFolder) => void;
  onOpenDocument: (document: OrganizationDocument) => void;
  onRenameFolder: (folder: DocumentFolder) => void;
  onMoveFolder: (folder: DocumentFolder) => void;
  onCopyFolder: (folder: DocumentFolder) => void;
  onDeleteFolder: (folder: DocumentFolder) => void;
  onDetailsDocument: (document: OrganizationDocument) => void;
  onRenameDocument: (document: OrganizationDocument) => void;
  onLinkDocument: (document: OrganizationDocument) => void;
  onMoveDocument: (document: OrganizationDocument) => void;
  onCopyDocument: (document: OrganizationDocument) => void;
  onDeleteDocument: (document: OrganizationDocument) => void;
  onRestoreDocument: (document: OrganizationDocument) => void;
  onPermanentDeleteDocument: (document: OrganizationDocument) => void;
  onToggleFolderSelection: (folderId: string) => void;
  onToggleDocumentSelection: (documentId: string) => void;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onBatchMoveSelection: () => void;
  onBatchCopySelection: () => void;
  onBatchDeleteSelection: () => void;
  onRectangleSelectionChange: (selection: DocumentTableItemSelection) => void;
  onRectangleSelectionComplete: () => void;
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

export const DOCUMENT_ROW_DRAG_MIME = 'application/x-werkflow-document-row';

function getFolderActionHandlers(
  folder: DocumentFolder,
  props: DocumentLibraryTableProps,
): FolderActionHandlers {
  return {
    onOpen: () => props.onOpenFolder(folder),
    onMove: () => props.onMoveFolder(folder),
    onCopy: () => props.onCopyFolder(folder),
    onRename: () => props.onRenameFolder(folder),
    onDelete: () => props.onDeleteFolder(folder),
  };
}

function getDocumentActionHandlers(
  document: OrganizationDocument,
  props: DocumentLibraryTableProps,
): DocumentActionHandlers {
  return {
    onOpen: () => props.onOpenDocument(document),
    onDetails: () => props.onDetailsDocument(document),
    onRename: () => props.onRenameDocument(document),
    onLink: () => props.onLinkDocument(document),
    onMove: () => props.onMoveDocument(document),
    onCopy: () => props.onCopyDocument(document),
    onDelete: () => props.onDeleteDocument(document),
    onRestore: () => props.onRestoreDocument(document),
    onPermanentDelete: () => props.onPermanentDeleteDocument(document),
  };
}

export function DocumentLibraryTable(props: DocumentLibraryTableProps): ReactElement {
  const { selectedFolderIds, selectedDocumentIds, isItemPending, onRectangleSelectionChange } = props;
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const suppressClickRef = useRef(false);
  const selection: DocumentTableItemSelection = {
    folderIds: selectedFolderIds,
    documentIds: selectedDocumentIds,
  };
  const { sortedItems, sortColumn, sortDirection, handleSort } = useDocumentLibraryTableSort(
    props.folders,
    props.documents,
  );
  const { selectionBoxStyle, handlePointerDown, handlePointerMove, handlePointerUp } =
    useDocumentLibraryTableRectangleSelection({
      tableContainerRef,
      rowRefs,
      suppressClickRef,
      sortedItems,
      onRectangleSelectionChange,
      onRectangleSelectionComplete: props.onRectangleSelectionComplete,
    });
  const { draggedItem, draggedSelection, dragTargetFolderId, dragPosition, handleRowPointerDown } =
    useDocumentLibraryTableRowDrag({
      suppressClickRef,
      selection,
      onDragSelectionStart: props.onDragSelectionStart,
      onDragSelectionEnd: props.onDragSelectionEnd,
      onMoveItemsToFolder: props.onMoveItemsToFolder,
      onMoveItemsToTrash: props.onMoveItemsToTrash,
      onPointerDropTargetChange: props.onPointerDropTargetChange,
      canDropSelectionIntoFolder: props.canDropSelectionIntoFolder,
    });

  const { toggleItemSelection, handleRowSelectionClick } = useDocumentLibraryTableClickSelection({
    suppressClickRef,
    sortedItems,
    selection,
    onToggleFolderSelection: props.onToggleFolderSelection,
    onToggleDocumentSelection: props.onToggleDocumentSelection,
    onRectangleSelectionChange,
  });

  const selectedItemCount = sortedItems.filter((item) => isTableItemSelected(item, selection)).length;
  const allVisibleSelected = sortedItems.length > 0 && selectedItemCount === sortedItems.length;

  function setRowRef(key: string, node: HTMLTableRowElement | null): void {
    if (node) {
      rowRefs.current.set(key, node);
      return;
    }

    rowRefs.current.delete(key);
  }

  function getRowProps(item: DocumentLibraryTableItem): DocumentLibraryTableRowProps {
    const isSelected = isTableItemSelected(item, selection);
    return {
      isSelected,
      hasMultiSelection: selectedItemCount > 1,
      isPending: props.isPending,
      isItemPending: isItemPending(item.kind === 'folder' ? item.folder.id : item.document.id),
      rowRef: (node) => setRowRef(item.key, node),
      onPointerDown: (event) => handleRowPointerDown(event, item),
      onSelectionClick: (event) => handleRowSelectionClick(event, item),
      onToggleSelection: () => toggleItemSelection(item),
      onClearSelection: props.onClearSelection,
      onActionsMenuOpenChange: () => {
        if (!(isSelected && selectedItemCount > 1)) {
          onRectangleSelectionChange(getSingleItemSelection(item));
        }
      },
      onBatchMoveSelection: props.onBatchMoveSelection,
      onBatchCopySelection: props.onBatchCopySelection,
      onBatchDeleteSelection: props.onBatchDeleteSelection,
    };
  }

  return (
    <div
      ref={tableContainerRef}
      className="relative -mx-4 hidden min-h-[50vh] flex-1 select-none px-4 sm:-mx-6 sm:px-6 md:block"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <Table>
        <DocumentLibraryTableHeader
          allVisibleSelected={allVisibleSelected}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          onToggleAllVisible={allVisibleSelected ? props.onClearSelection : props.onSelectAllVisible}
        />
        <TableBody>
          {sortedItems.map((item) =>
            item.kind === 'folder' ? (
              <DocumentLibraryTableFolderRow
                key={item.key}
                folder={item.folder}
                isDropTarget={dragTargetFolderId === item.folder.id}
                handlers={getFolderActionHandlers(item.folder, props)}
                {...getRowProps(item)}
              />
            ) : (
              <DocumentLibraryTableDocumentRow
                key={item.key}
                document={item.document}
                isTrashView={props.isTrashView}
                isDragActive={draggedItem !== null}
                handlers={getDocumentActionHandlers(item.document, props)}
                {...getRowProps(item)}
              />
            ),
          )}

          {sortedItems.length === 0 && (
            <TableRow>
              <TableCell colSpan={DOCUMENT_COLUMNS.length} className="whitespace-normal">
                <DocumentLibraryEmptyState searchQuery={props.searchQuery} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {selectionBoxStyle && (
        <div
          className="pointer-events-none absolute z-20 border border-primary bg-primary/15"
          style={selectionBoxStyle}
        />
      )}

      {draggedItem && draggedSelection && dragPosition && (
        <DocumentLibraryTableDragBadge
          draggedItem={draggedItem}
          draggedSelection={draggedSelection}
          dragPosition={dragPosition}
        />
      )}
    </div>
  );
}

/**
 * The library's loading frame: the desktop table with select-style rows and
 * the mobile card list, whose loaded rows open on click (see
 * document-library-content.tsx).
 */
export function DocumentTableSkeleton({ rowCount = 10 }: { rowCount?: number }) {
  return (
    <>
      <div className="relative -mx-4 hidden min-h-[50vh] flex-1 select-none px-4 sm:-mx-6 sm:px-6 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {DOCUMENT_COLUMNS.map((column) => (
                <TableHead key={column.id} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <SkeletonRows columns={DOCUMENT_COLUMNS} rows={rowCount} interactive="select" />
          </TableBody>
        </Table>
      </div>

      <SkeletonList interactive className="md:hidden">
        <Skeleton className="size-5 shrink-0 rounded-sm" />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-56 max-w-full" />
          </div>
        </div>
        <Skeleton className="size-8 shrink-0 rounded-md" />
      </SkeletonList>
    </>
  );
}
