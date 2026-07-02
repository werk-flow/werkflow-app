'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
} from 'lucide-react';

import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import {
  DocumentActionsMenu,
  DocumentContextMenuContent,
  FolderActionsMenu,
  FolderContextMenuContent,
  MultiSelectionContextMenuContent,
} from './document-row-actions';

type DocumentTableSortColumn =
  | 'name'
  | 'uploadedBy'
  | 'date'
  | 'size'
  | 'type'
  | 'linkedTo';

type SortDirection = 'asc' | 'desc';

type DocumentActionHandlers = {
  onOpen: () => void;
  onDetails: () => void;
  onRename: () => void;
  onLink: () => void;
  onMove: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
};

type FolderActionHandlers = {
  onOpen: () => void;
  onMove: () => void;
  onCopy: () => void;
  onRename: () => void;
  onDelete: () => void;
};

type DocumentLibraryTableProps = {
  folders: DocumentFolder[];
  documents: OrganizationDocument[];
  selectedFolderIds: Set<string>;
  selectedDocumentIds: Set<string>;
  isTrashView: boolean;
  isPending: boolean;
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
  onRectangleSelectionChange: (selection: {
    folderIds: Set<string>;
    documentIds: Set<string>;
  }) => void;
  onRectangleSelectionComplete: () => void;
  onDragSelectionStart: (selection: DocumentTableDragSelection) => void;
  onDragSelectionEnd: () => void;
  onMoveItemsToFolder: (input: {
    selection: DocumentTableDragSelection;
    targetFolderId: string | null;
  }) => void;
  onMoveItemsToTrash: (selection: DocumentTableDragSelection) => void;
  onPointerDropTargetChange: (
    target:
      | { kind: 'folder'; folderId: string | null }
      | { kind: 'trash' }
      | null
  ) => void;
  canDropSelectionIntoFolder: (
    selection: DocumentTableDragSelection,
    targetFolderId: string | null
  ) => boolean;
};

export type DocumentLibraryTableItem =
  | {
      kind: 'folder';
      key: string;
      folder: DocumentFolder;
    }
  | {
      kind: 'document';
      key: string;
      document: OrganizationDocument;
};

type SelectionBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isDragging: boolean;
} | null;

type DraggedTableItem = DocumentLibraryTableItem | null;

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

export const DOCUMENT_ROW_DRAG_MIME = 'application/x-werkflow-document-row';

export type DocumentTableDragSelection = {
  folderIds: string[];
  documentIds: string[];
};

function startDocumentDragState() {
  document.body.style.userSelect = 'none';
}

function clearDocumentDragState() {
  document.body.style.userSelect = '';
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date));
}

function getUploaderName(document: OrganizationDocument): string {
  return getUserDisplayName(document.uploader);
}

function getUserDisplayName(
  uploader: OrganizationDocument['uploader'] | DocumentFolder['creator']
): string {
  if (!uploader) return 'Unbekannt';

  const fullName = [uploader.firstName, uploader.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return fullName || uploader.email || 'Unbekannt';
}

function getFileIcon(document: OrganizationDocument) {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();

  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return FileText;
  if (
    mimeType.includes('spreadsheet') ||
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.csv')
  ) {
    return FileSpreadsheet;
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return FileArchive;
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return FileType;
  }
  return File;
}

function getFileTypeLabel(document: OrganizationDocument): string {
  const mimeType = document.mimeType ?? '';
  const fileName = document.displayName.toLowerCase();

  if (mimeType.startsWith('image/')) return 'Bild';
  if (mimeType === 'application/pdf' || fileName.endsWith('.pdf')) return 'PDF';
  if (
    mimeType.includes('spreadsheet') ||
    fileName.endsWith('.xlsx') ||
    fileName.endsWith('.csv')
  ) {
    return 'Tabelle';
  }
  if (mimeType.includes('word') || fileName.endsWith('.doc') || fileName.endsWith('.docx')) {
    return 'Dokument';
  }
  if (mimeType.includes('zip') || fileName.endsWith('.zip') || fileName.endsWith('.rar')) {
    return 'Archiv';
  }
  return 'Datei';
}

function getLinkBadges(document: OrganizationDocument): string[] {
  return document.links.map((link) => {
    if (link.jobId) {
      return link.jobNumber
        ? `Auftrag ${link.jobNumber}`
        : link.jobTitle
          ? `Auftrag: ${link.jobTitle}`
          : 'Auftrag';
    }

    if (link.clientId) {
      return link.clientName ? `Kunde: ${link.clientName}` : 'Kunde';
    }

    return link.projectNumber
      ? `Projekt ${link.projectNumber}`
      : link.projectName
        ? `Projekt: ${link.projectName}`
        : 'Projekt';
  });
}

function getItemName(item: DocumentLibraryTableItem): string {
  return item.kind === 'folder' ? item.folder.name : item.document.displayName;
}

function getItemDate(item: DocumentLibraryTableItem): string {
  return item.kind === 'folder' ? item.folder.createdAt : item.document.updatedAt;
}

function getItemType(item: DocumentLibraryTableItem): string {
  return item.kind === 'folder' ? 'Ordner' : getFileTypeLabel(item.document);
}

function getItemLinkedTo(item: DocumentLibraryTableItem): string {
  return item.kind === 'folder' ? '' : getLinkBadges(item.document).join(' ');
}

function getDragSelectionLabel(selection: DocumentTableDragSelection): string {
  const folderCount = selection.folderIds.length;
  const documentCount = selection.documentIds.length;
  const totalCount = folderCount + documentCount;

  if (folderCount > 0 && documentCount > 0) {
    return totalCount === 1 ? '1 Objekt' : `${totalCount} Objekte`;
  }

  if (folderCount > 0) {
    return folderCount === 1 ? '1 Ordner' : `${folderCount} Ordner`;
  }

  return documentCount === 1 ? '1 Dokument' : `${documentCount} Dokumente`;
}

function getSortValue(
  item: DocumentLibraryTableItem,
  column: DocumentTableSortColumn
): string | number {
  if (column === 'name') return getItemName(item).toLocaleLowerCase('de-DE');
  if (column === 'uploadedBy') {
    return item.kind === 'folder'
      ? getUserDisplayName(item.folder.creator).toLocaleLowerCase('de-DE')
      : getUploaderName(item.document).toLocaleLowerCase('de-DE');
  }
  if (column === 'date') return new Date(getItemDate(item)).getTime();
  if (column === 'size') return item.kind === 'folder' ? -1 : item.document.sizeBytes;
  if (column === 'type') return getItemType(item).toLocaleLowerCase('de-DE');
  return getItemLinkedTo(item).toLocaleLowerCase('de-DE');
}

function compareItems(
  firstItem: DocumentLibraryTableItem,
  secondItem: DocumentLibraryTableItem,
  column: DocumentTableSortColumn,
  direction: SortDirection
): number {
  const firstValue = getSortValue(firstItem, column);
  const secondValue = getSortValue(secondItem, column);
  const multiplier = direction === 'asc' ? 1 : -1;

  let result =
    typeof firstValue === 'number' && typeof secondValue === 'number'
      ? firstValue - secondValue
      : String(firstValue).localeCompare(String(secondValue), 'de-DE', {
          numeric: true,
          sensitivity: 'base',
        });

  if (result === 0) {
    result = getItemName(firstItem).localeCompare(getItemName(secondItem), 'de-DE', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (result === 0 && firstItem.kind !== secondItem.kind) {
    result = firstItem.kind === 'folder' ? -1 : 1;
  }

  return result * multiplier;
}

function SortableHeader({
  label,
  column,
  currentColumn,
  currentDirection,
  onSort,
  className,
}: {
  label: string;
  column: DocumentTableSortColumn;
  currentColumn: DocumentTableSortColumn;
  currentDirection: SortDirection;
  onSort: (column: DocumentTableSortColumn) => void;
  className?: string;
}) {
  const isActive = currentColumn === column;

  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className="-ml-1 flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground"
      >
        {label}
        {isActive ? (
          currentDirection === 'asc' ? (
            <ArrowUp className="size-3.5" />
          ) : (
            <ArrowDown className="size-3.5" />
          )
        ) : (
          <ArrowUpDown className="size-3.5 text-muted-foreground/50" />
        )}
      </button>
    </TableHead>
  );
}

function SelectionCircle({
  checked,
  alwaysVisible = false,
  label,
  onClick,
}: {
  checked: boolean;
  alwaysVisible?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      data-table-interactive="true"
      data-document-selection-circle="true"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cn(
        'flex size-5 cursor-pointer items-center justify-center rounded-full border transition-all',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-muted-foreground/50 bg-background text-transparent hover:border-primary',
        checked || alwaysVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      )}
    >
      {checked && <Check className="size-3.5" />}
    </button>
  );
}

function getBoxStyle(selectionBox: SelectionBox) {
  if (!selectionBox || !selectionBox.isDragging) return null;

  const left = Math.min(selectionBox.startX, selectionBox.currentX);
  const top = Math.min(selectionBox.startY, selectionBox.currentY);
  const width = Math.abs(selectionBox.currentX - selectionBox.startX);
  const height = Math.abs(selectionBox.currentY - selectionBox.startY);

  return { left, top, width, height };
}

function intersects(
  first: { left: number; top: number; right: number; bottom: number },
  second: { left: number; top: number; right: number; bottom: number }
): boolean {
  return (
    first.left <= second.right &&
    first.right >= second.left &&
    first.top <= second.bottom &&
    first.bottom >= second.top
  );
}

export function DocumentLibraryTable({
  folders,
  documents,
  selectedFolderIds,
  selectedDocumentIds,
  isTrashView,
  isPending,
  onOpenFolder,
  onOpenDocument,
  onRenameFolder,
  onMoveFolder,
  onCopyFolder,
  onDeleteFolder,
  onDetailsDocument,
  onRenameDocument,
  onLinkDocument,
  onMoveDocument,
  onCopyDocument,
  onDeleteDocument,
  onRestoreDocument,
  onPermanentDeleteDocument,
  onToggleFolderSelection,
  onToggleDocumentSelection,
  onSelectAllVisible,
  onClearSelection,
  onBatchMoveSelection,
  onBatchCopySelection,
  onBatchDeleteSelection,
  onRectangleSelectionChange,
  onRectangleSelectionComplete,
  onDragSelectionStart,
  onDragSelectionEnd,
  onMoveItemsToFolder,
  onMoveItemsToTrash,
  onPointerDropTargetChange,
  canDropSelectionIntoFolder,
}: DocumentLibraryTableProps) {
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const suppressClickRef = useRef(false);
  const pendingRowDragRef = useRef<PendingRowDrag | null>(null);
  const [sortColumn, setSortColumn] = useState<DocumentTableSortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectionBox, setSelectionBox] = useState<SelectionBox>(null);
  const [draggedItem, setDraggedItem] = useState<DraggedTableItem>(null);
  const [draggedSelection, setDraggedSelection] =
    useState<DocumentTableDragSelection | null>(null);
  const [dragTargetFolderId, setDragTargetFolderId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);

  const sortedItems = useMemo<DocumentLibraryTableItem[]>(() => {
    const items: DocumentLibraryTableItem[] = [
      ...folders.map((folder) => ({
        kind: 'folder' as const,
        key: `folder-${folder.id}`,
        folder,
      })),
      ...documents.map((document) => ({
        kind: 'document' as const,
        key: `document-${document.id}`,
        document,
      })),
    ];

    return items.sort((firstItem, secondItem) =>
      compareItems(firstItem, secondItem, sortColumn, sortDirection)
    );
  }, [documents, folders, sortColumn, sortDirection]);

  const visibleItemCount = sortedItems.length;
  const visibleSelectedItemCount = sortedItems.filter((item) =>
    item.kind === 'folder'
      ? selectedFolderIds.has(item.folder.id)
      : selectedDocumentIds.has(item.document.id)
  ).length;
  const allVisibleSelected =
    visibleItemCount > 0 && visibleSelectedItemCount === visibleItemCount;
  const selectedItemCount = visibleSelectedItemCount;

  function openFromDoubleClick(onOpen: () => void) {
    onOpen();
  }

  function handleSort(column: DocumentTableSortColumn) {
    if (column === sortColumn) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortColumn(column);
    setSortDirection('asc');
  }

  function setRowRef(key: string, node: HTMLTableRowElement | null) {
    if (node) {
      rowRefs.current.set(key, node);
      return;
    }

    rowRefs.current.delete(key);
  }

  function handleHeaderSelection() {
    if (allVisibleSelected) {
      onClearSelection();
      return;
    }

    onSelectAllVisible();
  }

  function isItemSelected(item: DocumentLibraryTableItem): boolean {
    return item.kind === 'folder'
      ? selectedFolderIds.has(item.folder.id)
      : selectedDocumentIds.has(item.document.id);
  }

  function getSingleItemSelection(item: DocumentLibraryTableItem) {
    return {
      folderIds: new Set(item.kind === 'folder' ? [item.folder.id] : []),
      documentIds: new Set(item.kind === 'document' ? [item.document.id] : []),
    };
  }

  function getSelectionWithNearestRange(targetKey: string) {
    const targetIndex = sortedItems.findIndex((item) => item.key === targetKey);
    if (targetIndex === -1) return null;

    const selectedIndexes = sortedItems
      .map((item, index) => (isItemSelected(item) ? index : -1))
      .filter((index) => index !== -1);

    const nearestSelectedIndex = selectedIndexes.reduce<number | null>(
      (nearestIndex, selectedIndex) => {
        if (nearestIndex === null) return selectedIndex;

        const currentDistance = Math.abs(selectedIndex - targetIndex);
        const nearestDistance = Math.abs(nearestIndex - targetIndex);
        return currentDistance < nearestDistance ? selectedIndex : nearestIndex;
      },
      null
    );

    const rangeStartIndex =
      nearestSelectedIndex === null ? targetIndex : Math.min(nearestSelectedIndex, targetIndex);
    const rangeEndIndex =
      nearestSelectedIndex === null ? targetIndex : Math.max(nearestSelectedIndex, targetIndex);
    const folderIds = new Set(selectedFolderIds);
    const documentIds = new Set(selectedDocumentIds);

    for (const item of sortedItems.slice(rangeStartIndex, rangeEndIndex + 1)) {
      if (item.kind === 'folder') {
        folderIds.add(item.folder.id);
      } else {
        documentIds.add(item.document.id);
      }
    }

    return { folderIds, documentIds };
  }

  function handleRowSelectionClick(
    event: MouseEvent<HTMLTableRowElement>,
    item: DocumentLibraryTableItem
  ) {
    if (suppressClickRef.current || event.detail > 1) return;
    event.stopPropagation();
    const isAdditiveClick = event.ctrlKey || event.metaKey;
    const isRangeClick = event.shiftKey;

    if (isRangeClick) {
      const rangeSelection = getSelectionWithNearestRange(item.key);
      if (rangeSelection) {
        onRectangleSelectionChange(rangeSelection);
        return;
      }
    }

    if (isAdditiveClick) {
      if (!isItemSelected(item)) {
        if (item.kind === 'folder') {
          onToggleFolderSelection(item.folder.id);
        } else {
          onToggleDocumentSelection(item.document.id);
        }
      }
      return;
    }

    onRectangleSelectionChange(getSingleItemSelection(item));
  }

  function handleRowContextMenu(event: MouseEvent<HTMLTableRowElement>) {
    event.stopPropagation();
  }

  useEffect(() => {
    return () => {
      pendingRowDragRef.current = null;
      clearDocumentDragState();
    };
  }, []);

  function updateRectangleSelection(nextBox: SelectionBox) {
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

  function shouldIgnorePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
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

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
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

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
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

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
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

  const selectionBoxStyle = getBoxStyle(selectionBox);

  function buildDragSelection(item: DocumentLibraryTableItem): DocumentTableDragSelection {
    return isItemSelected(item)
      ? {
          folderIds: Array.from(selectedFolderIds),
          documentIds: Array.from(selectedDocumentIds),
        }
      : {
          folderIds: item.kind === 'folder' ? [item.folder.id] : [],
          documentIds: item.kind === 'document' ? [item.document.id] : [],
        };
  }

  function clearPointerDrag() {
    pendingRowDragRef.current = null;
    setDraggedItem(null);
    setDraggedSelection(null);
    setDragTargetFolderId(null);
    setDragPosition(null);
    onPointerDropTargetChange(null);
    onDragSelectionEnd();
    clearDocumentDragState();
  }

  function getPointerDropTarget(
    clientX: number,
    clientY: number,
    selection: DocumentTableDragSelection
  ): PointerDropTarget {
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!element) return null;

    if (element.closest('[data-document-trash-drop="true"]')) {
      return { kind: 'trash' };
    }

    const breadcrumbTarget = element.closest<HTMLElement>(
      '[data-document-breadcrumb-folder-drop-id]'
    );
    if (breadcrumbTarget) {
      const rawFolderId = breadcrumbTarget.dataset.documentBreadcrumbFolderDropId;
      const folderId = rawFolderId === 'root' ? null : rawFolderId || null;
      return canDropSelectionIntoFolder(selection, folderId)
        ? { kind: 'folder', folderId, scope: 'breadcrumb' }
        : null;
    }

    const tableFolderTarget = element.closest<HTMLElement>(
      '[data-document-table-folder-drop-id]'
    );
    if (tableFolderTarget) {
      const folderId = tableFolderTarget.dataset.documentTableFolderDropId ?? null;
      return folderId && canDropSelectionIntoFolder(selection, folderId)
        ? { kind: 'folder', folderId, scope: 'table' }
        : null;
    }

    return null;
  }

  function updatePointerDropTarget(
    clientX: number,
    clientY: number,
    selection: DocumentTableDragSelection
  ): PointerDropTarget {
    const target = getPointerDropTarget(clientX, clientY, selection);
    setDragTargetFolderId(
      target?.kind === 'folder' && target.scope === 'table' && target.folderId
        ? target.folderId
        : null
    );
    onPointerDropTargetChange(
      target?.kind === 'trash'
        ? { kind: 'trash' }
        : target?.kind === 'folder' && target.scope === 'breadcrumb'
          ? { kind: 'folder', folderId: target.folderId }
          : null
    );
    return target;
  }

  function startPointerDrag(pendingDrag: PendingRowDrag, clientX: number, clientY: number) {
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
    item: DocumentLibraryTableItem
  ) {
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

  function handleWindowPointerMove(event: PointerEvent) {
    const pendingDrag = pendingRowDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) return;

    const movedFarEnough =
      Math.abs(event.clientX - pendingDrag.startX) > 4 ||
      Math.abs(event.clientY - pendingDrag.startY) > 4;

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

  function handleWindowPointerUp(event: PointerEvent) {
    const pendingDrag = pendingRowDragRef.current;
    if (!pendingDrag || pendingDrag.pointerId !== event.pointerId) return;

    const dropTarget = pendingDrag.isActive
      ? getPointerDropTarget(event.clientX, event.clientY, pendingDrag.selection)
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

  useEffect(() => {
    window.addEventListener('pointermove', handleWindowPointerMove, {
      passive: false,
    });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', clearPointerDrag);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', clearPointerDrag);
    };
  });

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
        <TableHeader>
          <TableRow>
            <TableHead className="w-[36px]">
              <SelectionCircle
                checked={allVisibleSelected}
                alwaysVisible
                label={
                  allVisibleSelected
                    ? 'Alle sichtbaren Einträge abwählen'
                    : 'Alle sichtbaren Einträge auswählen'
                }
                onClick={handleHeaderSelection}
              />
            </TableHead>
            <SortableHeader
              label="Name"
              column="name"
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={handleSort}
            />
            <SortableHeader
              label="Erstellt / Hochgeladen von"
              column="uploadedBy"
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={handleSort}
              className="hidden md:table-cell"
            />
            <SortableHeader
              label="Datum"
              column="date"
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={handleSort}
              className="hidden w-[140px] sm:table-cell"
            />
            <SortableHeader
              label="Größe"
              column="size"
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={handleSort}
              className="hidden w-[110px] sm:table-cell"
            />
            <SortableHeader
              label="Typ"
              column="type"
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={handleSort}
              className="hidden w-[120px] lg:table-cell"
            />
            <SortableHeader
              label="Verknüpft mit"
              column="linkedTo"
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={handleSort}
              className="hidden xl:table-cell"
            />
            <TableHead className="w-[50px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedItems.map((item) => {
            if (item.kind === 'folder') {
              const { folder } = item;
              const isSelected = selectedFolderIds.has(folder.id);
              const handlers: FolderActionHandlers = {
                onOpen: () => onOpenFolder(folder),
                onMove: () => onMoveFolder(folder),
                onCopy: () => onCopyFolder(folder),
                onRename: () => onRenameFolder(folder),
                onDelete: () => onDeleteFolder(folder),
              };

              return (
                <ContextMenu key={item.key} modal={false}>
                  <ContextMenuTrigger asChild>
                    <TableRow
                      ref={(node) => setRowRef(item.key, node)}
                      data-state={isSelected ? 'selected' : undefined}
                      data-document-selection-preserve="true"
                      data-document-table-folder-drop-id={folder.id}
                      className={cn(
                        'group cursor-default transition-colors hover:bg-accent/50',
                        isSelected && 'bg-primary/10 hover:bg-primary/15',
                        dragTargetFolderId === folder.id && 'bg-primary/20 outline outline-1 outline-primary/60'
                      )}
                      onPointerDown={(event) => handleRowPointerDown(event, item)}
                      onClick={(event) => handleRowSelectionClick(event, item)}
                      onDoubleClick={() => openFromDoubleClick(() => onOpenFolder(folder))}
                      onContextMenu={handleRowContextMenu}
                    >
                      <TableCell>
                        <SelectionCircle
                          checked={isSelected}
                          label={`Ordner ${folder.name} auswählen`}
                          onClick={() => onToggleFolderSelection(folder.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          data-table-interactive="true"
                          className="flex min-w-0 items-center gap-2 font-medium text-left hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            onClearSelection();
                            onOpenFolder(folder);
                          }}
                        >
                          <Folder className="size-4 shrink-0 text-muted-foreground" />
                          <span className="truncate">{folder.name}</span>
                        </button>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">
                        {getUserDisplayName(folder.creator)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        {formatDate(folder.createdAt)}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground sm:table-cell">
                        -
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">
                        Ordner
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground xl:table-cell">
                        -
                      </TableCell>
                      <TableCell data-table-interactive="true">
                        <FolderActionsMenu
                          folder={folder}
                          disabled={isPending}
                          handlers={handlers}
                          onOpenChange={() => {
                            if (!(isSelected && selectedItemCount > 1)) {
                              onRectangleSelectionChange(getSingleItemSelection(item));
                            }
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  </ContextMenuTrigger>
                  {selectedItemCount > 1 && isSelected ? (
                    <MultiSelectionContextMenuContent
                      onMove={onBatchMoveSelection}
                      onCopy={onBatchCopySelection}
                      onDelete={onBatchDeleteSelection}
                    />
                  ) : (
                    <FolderContextMenuContent folder={folder} handlers={handlers} />
                  )}
                </ContextMenu>
              );
            }

            const { document } = item;
            const FileIcon = getFileIcon(document);
            const linkBadges = getLinkBadges(document);
            const isSelected = selectedDocumentIds.has(document.id);
            const handlers: DocumentActionHandlers = {
              onOpen: () => onOpenDocument(document),
              onDetails: () => onDetailsDocument(document),
              onRename: () => onRenameDocument(document),
              onLink: () => onLinkDocument(document),
              onMove: () => onMoveDocument(document),
              onCopy: () => onCopyDocument(document),
              onDelete: () => onDeleteDocument(document),
              onRestore: () => onRestoreDocument(document),
              onPermanentDelete: () => onPermanentDeleteDocument(document),
            };

            return (
              <ContextMenu key={item.key} modal={false}>
                <ContextMenuTrigger asChild>
                  <TableRow
                    ref={(node) => setRowRef(item.key, node)}
                    data-state={isSelected ? 'selected' : undefined}
                    data-document-selection-preserve="true"
                    className={cn(
                      'group cursor-default transition-colors hover:bg-accent/50',
                      isSelected && 'bg-primary/10 hover:bg-primary/15',
                      draggedItem &&
                        'cursor-not-allowed opacity-45 saturate-50 hover:bg-transparent'
                    )}
                    onPointerDown={(event) => handleRowPointerDown(event, item)}
                    onClick={(event) => handleRowSelectionClick(event, item)}
                    onDoubleClick={() => openFromDoubleClick(() => onOpenDocument(document))}
                    onContextMenu={handleRowContextMenu}
                  >
                    <TableCell>
                      <SelectionCircle
                        checked={isSelected}
                        label={`Datei ${document.displayName} auswählen`}
                        onClick={() => onToggleDocumentSelection(document.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        data-table-interactive="true"
                        className="flex min-w-0 items-center gap-2 font-medium text-left hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClearSelection();
                          onOpenDocument(document);
                        }}
                      >
                        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate">{document.displayName}</span>
                      </button>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {getUploaderName(document)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDate(document.updatedAt)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatFileSize(document.sizeBytes)}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {getFileTypeLabel(document)}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      {linkBadges.length === 0 ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <div className="flex max-w-64 flex-wrap gap-1">
                          {linkBadges.slice(0, 2).map((badge) => (
                            <span
                              key={badge}
                              className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary-foreground"
                            >
                              {badge}
                            </span>
                          ))}
                          {linkBadges.length > 2 && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              +{linkBadges.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell data-table-interactive="true">
                      <DocumentActionsMenu
                        document={document}
                        isTrashView={isTrashView}
                        disabled={isPending}
                        handlers={handlers}
                        onOpenChange={() => {
                          if (!(isSelected && selectedItemCount > 1)) {
                            onRectangleSelectionChange(getSingleItemSelection(item));
                          }
                        }}
                      />
                    </TableCell>
                  </TableRow>
                </ContextMenuTrigger>
                {selectedItemCount > 1 && isSelected ? (
                  <MultiSelectionContextMenuContent
                    onMove={onBatchMoveSelection}
                    onCopy={onBatchCopySelection}
                    onDelete={onBatchDeleteSelection}
                  />
                ) : (
                  <DocumentContextMenuContent
                    document={document}
                    isTrashView={isTrashView}
                    handlers={handlers}
                  />
                )}
              </ContextMenu>
            );
          })}

          {sortedItems.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="h-48 text-center text-sm text-muted-foreground"
              >
                Noch keine Dokumente gefunden.
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
        <div
          className="pointer-events-none fixed z-50 inline-flex max-w-70 items-center gap-1.5 truncate rounded-full border bg-popover px-2.5 py-1 text-xs font-medium text-popover-foreground shadow-lg"
          style={{
            left: dragPosition.x + 14,
            top: dragPosition.y + 14,
          }}
        >
          {draggedSelection.folderIds.length > 0 && (
            <Folder className="size-3.5 shrink-0" />
          )}
          {draggedSelection.documentIds.length > 0 &&
            (draggedSelection.folderIds.length > 0 ? (
              <File className="size-3.5 shrink-0" />
            ) : draggedItem.kind === 'document' ? (
              (() => {
                const DragIcon = getFileIcon(draggedItem.document);
                return <DragIcon className="size-3.5 shrink-0" />;
              })()
            ) : (
              <File className="size-3.5 shrink-0" />
            ))}
          <span className="truncate">{getDragSelectionLabel(draggedSelection)}</span>
        </div>
      )}
    </div>
  );
}
