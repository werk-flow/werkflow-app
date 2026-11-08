'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonRows } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableHeader } from '@/components/ui/table';
import {
  DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS,
  type AuftraegeColumnId,
} from '@/lib/jobs/auftraege-table-columns';
import { auftraegeColumns } from './unified-auftraege-columns';
import { AuftraegeTableHeaderRow, type AuftraegeSortState } from './unified-auftraege-table-header';

// Its own module: the app shell's org-switch overlay renders this skeleton on every
// page, and the table module would bring the rows, row menus and their dialogs along.

/** Loading placeholder with the exact frame of the loaded list; every row is a link, so rows hover. */
export function AuftraegeTableSkeleton({
  count,
  showActions,
  visibleColumns = DEFAULT_VISIBLE_AUFTRAEGE_COLUMNS,
  sort,
}: {
  count: number;
  showActions: boolean;
  visibleColumns?: AuftraegeColumnId[] | undefined;
  sort?: AuftraegeSortState | undefined;
}) {
  const columns = auftraegeColumns(visibleColumns, showActions);
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-32" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-3 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        {showActions && <Skeleton className="h-8 w-8 shrink-0 rounded" />}
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <AuftraegeTableHeaderRow columns={columns} sort={sort} />
          </TableHeader>
          <TableBody>
            <SkeletonRows columns={columns} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}
