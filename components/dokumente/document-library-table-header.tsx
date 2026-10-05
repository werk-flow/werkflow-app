'use client';

import type { ReactElement } from 'react';

import { SortableTableHead } from '@/components/ui/sortable-table-head';
import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { DocumentTableSortColumn, SortDirection } from './document-library-table-items';
import { SelectionCircle, SkeletonSelectionCircle } from './document-library-table-selection-circle';

type DocumentColumn = SkeletonColumn & {
  id: DocumentTableSortColumn | 'selection' | 'actions';
};

// One column definition for the loaded header, the empty row and the skeleton
// (design canon): widths, breakpoints and cell count cannot drift apart. The
// loaded header swaps in the live selection control and sort buttons.
export const DOCUMENT_COLUMNS: readonly DocumentColumn[] = [
  {
    id: 'selection',
    header: <SkeletonSelectionCircle visible />,
    className: 'w-[36px]',
    skeleton: <SkeletonSelectionCircle />,
  },
  {
    id: 'name',
    header: 'Name',
    skeleton: (
      <div className="flex min-w-0 items-center gap-2">
        <Skeleton className="size-4 shrink-0 rounded-sm" />
        <Skeleton className="h-4 w-52 max-w-[75%]" />
      </div>
    ),
  },
  {
    id: 'uploadedBy',
    header: 'Erstellt / Hochgeladen von',
    className: 'hidden md:table-cell',
    skeleton: <Skeleton className="h-4 w-36 max-w-full" />,
  },
  {
    id: 'date',
    header: 'Datum',
    className: 'hidden w-[140px] sm:table-cell',
    skeleton: <Skeleton className="h-4 w-20" />,
  },
  {
    id: 'size',
    header: 'Größe',
    className: 'hidden w-[110px] sm:table-cell',
    skeleton: <Skeleton className="h-4 w-14" />,
  },
  {
    id: 'type',
    header: 'Typ',
    className: 'hidden w-[120px] lg:table-cell',
    skeleton: <Skeleton className="h-4 w-16" />,
  },
  {
    id: 'linkedTo',
    header: 'Verknüpft mit',
    className: 'hidden xl:table-cell',
    skeleton: (
      <div className="flex max-w-64 gap-1">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    ),
  },
  {
    id: 'actions',
    header: null,
    className: 'w-[50px]',
    skeleton: <Skeleton className="ml-auto size-8 rounded-md" />,
  },
];

type DocumentLibraryTableHeaderProps = {
  allVisibleSelected: boolean;
  sortColumn: DocumentTableSortColumn;
  sortDirection: SortDirection;
  onSort: (column: DocumentTableSortColumn) => void;
  onToggleAllVisible: () => void;
};

/** The loaded header: live selection control and sort buttons over the shared columns. */
export function DocumentLibraryTableHeader({
  allVisibleSelected,
  sortColumn,
  sortDirection,
  onSort,
  onToggleAllVisible,
}: DocumentLibraryTableHeaderProps): ReactElement {
  return (
    <TableHeader>
      <TableRow>
        {DOCUMENT_COLUMNS.map((column) => {
          if (column.id === 'selection') {
            return (
              <TableHead key={column.id} className={column.className}>
                <SelectionCircle
                  checked={allVisibleSelected}
                  alwaysVisible
                  label={
                    allVisibleSelected
                      ? 'Alle sichtbaren Einträge abwählen'
                      : 'Alle sichtbaren Einträge auswählen'
                  }
                  onClick={onToggleAllVisible}
                />
              </TableHead>
            );
          }
          if (column.id === 'actions') {
            return <TableHead key={column.id} className={column.className} />;
          }
          return (
            <SortableTableHead
              key={column.id}
              label={column.header}
              column={column.id}
              currentColumn={sortColumn}
              currentDirection={sortDirection}
              onSort={onSort}
              className={column.className}
            />
          );
        })}
      </TableRow>
    </TableHeader>
  );
}
