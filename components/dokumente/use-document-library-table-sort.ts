'use client';

import { useMemo, useState } from 'react';

import type { DocumentFolder, OrganizationDocument } from '@/lib/documents/types';
import {
  compareItems,
  type DocumentLibraryTableItem,
  type DocumentTableSortColumn,
  type SortDirection,
} from './document-library-table-items';

type DocumentLibraryTableSort = {
  sortedItems: DocumentLibraryTableItem[];
  sortColumn: DocumentTableSortColumn;
  sortDirection: SortDirection;
  handleSort: (column: DocumentTableSortColumn) => void;
};

/** Folders and documents as one list of rows in the chosen sort order. */
export function useDocumentLibraryTableSort(
  folders: DocumentFolder[],
  documents: OrganizationDocument[],
): DocumentLibraryTableSort {
  const [sortColumn, setSortColumn] = useState<DocumentTableSortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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
      compareItems(firstItem, secondItem, sortColumn, sortDirection),
    );
  }, [documents, folders, sortColumn, sortDirection]);

  function handleSort(column: DocumentTableSortColumn): void {
    if (column === sortColumn) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }

    setSortColumn(column);
    setSortDirection('asc');
  }

  return { sortedItems, sortColumn, sortDirection, handleSort };
}
