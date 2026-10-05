'use client';

import { SortableTableHead } from '@/components/ui/sortable-table-head';
import { TableHead, TableRow } from '@/components/ui/table';
import type { SortColumn } from '@/lib/jobs/types';
import type { AuftraegeTableColumn, AuftraegeTableColumnId } from './unified-auftraege-columns';

function isSortableColumn(columnId: AuftraegeTableColumnId): columnId is SortColumn {
  return columnId !== 'selection' && columnId !== 'actions' && columnId !== 'mitarbeiter';
}

export interface AuftraegeSortState {
  column: SortColumn;
  direction: 'asc' | 'desc';
  onSort: (column: SortColumn) => void;
  /** Archived entries keep a fixed status column. */
  isArchive?: boolean | undefined;
}

export function AuftraegeTableHeaderRow({
  columns,
  sort,
}: {
  columns: readonly AuftraegeTableColumn[];
  /** Omitted by route skeletons, which render plain headers. */
  sort?: AuftraegeSortState | undefined;
}) {
  return (
    <TableRow>
      {columns.map((column) =>
        sort && isSortableColumn(column.id) && !(sort.isArchive && column.id === 'status') ? (
          <SortableTableHead
            key={column.id}
            label={column.header}
            column={column.id}
            currentColumn={sort.column}
            currentDirection={sort.direction}
            onSort={sort.onSort}
            className={column.className}
          />
        ) : (
          <TableHead key={column.id} className={column.className}>
            {column.header}
          </TableHead>
        ),
      )}
    </TableRow>
  );
}
