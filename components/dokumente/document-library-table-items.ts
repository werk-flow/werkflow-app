import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import {
  getFileTypeLabel,
  getLinkBadges,
  getUploaderName,
  getUserDisplayName,
} from './document-library-file-labels';

export type DocumentTableSortColumn = 'name' | 'uploadedBy' | 'date' | 'size' | 'type' | 'linkedTo';

export type SortDirection = 'asc' | 'desc';

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

export type DocumentTableDragSelection = {
  folderIds: string[];
  documentIds: string[];
};

export type DocumentTableItemSelection = {
  folderIds: Set<string>;
  documentIds: Set<string>;
};

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

export function getDragSelectionLabel(selection: DocumentTableDragSelection): string {
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

function getSortValue(item: DocumentLibraryTableItem, column: DocumentTableSortColumn): string | number {
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

export function compareItems(
  firstItem: DocumentLibraryTableItem,
  secondItem: DocumentLibraryTableItem,
  column: DocumentTableSortColumn,
  direction: SortDirection,
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

export function isTableItemSelected(
  item: DocumentLibraryTableItem,
  selection: DocumentTableItemSelection,
): boolean {
  return item.kind === 'folder'
    ? selection.folderIds.has(item.folder.id)
    : selection.documentIds.has(item.document.id);
}

export function getSingleItemSelection(item: DocumentLibraryTableItem): DocumentTableItemSelection {
  return {
    folderIds: new Set(item.kind === 'folder' ? [item.folder.id] : []),
    documentIds: new Set(item.kind === 'document' ? [item.document.id] : []),
  };
}

/**
 * Extends the current selection by the rows between the target and the
 * selected row nearest to it (shift-click).
 */
export function getSelectionWithNearestRange(
  sortedItems: DocumentLibraryTableItem[],
  targetKey: string,
  selection: DocumentTableItemSelection,
): DocumentTableItemSelection | null {
  const targetIndex = sortedItems.findIndex((item) => item.key === targetKey);
  if (targetIndex === -1) return null;

  const selectedIndexes = sortedItems
    .map((item, index) => (isTableItemSelected(item, selection) ? index : -1))
    .filter((index) => index !== -1);

  const nearestSelectedIndex = selectedIndexes.reduce<number | null>((nearestIndex, selectedIndex) => {
    if (nearestIndex === null) return selectedIndex;

    const currentDistance = Math.abs(selectedIndex - targetIndex);
    const nearestDistance = Math.abs(nearestIndex - targetIndex);
    return currentDistance < nearestDistance ? selectedIndex : nearestIndex;
  }, null);

  const rangeStartIndex =
    nearestSelectedIndex === null ? targetIndex : Math.min(nearestSelectedIndex, targetIndex);
  const rangeEndIndex =
    nearestSelectedIndex === null ? targetIndex : Math.max(nearestSelectedIndex, targetIndex);
  const folderIds = new Set(selection.folderIds);
  const documentIds = new Set(selection.documentIds);

  for (const item of sortedItems.slice(rangeStartIndex, rangeEndIndex + 1)) {
    if (item.kind === 'folder') {
      folderIds.add(item.folder.id);
    } else {
      documentIds.add(item.document.id);
    }
  }

  return { folderIds, documentIds };
}
