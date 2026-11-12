'use client';

import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  hiddenHeader,
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody } from '@/components/ui/table';

// The customer table's frame, apart from its rows: every page's org-switch
// overlay draws the skeleton, and must not load the table with its customer
// and role code.

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart.
export const CLIENT_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'name',
    header: 'Name',
    className: 'w-[25%]',
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  {
    id: 'type',
    header: 'Typ',
    className: 'w-[120px] px-4',
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  { id: 'email', header: 'E-Mail', skeleton: <Skeleton className="h-5 w-40" /> },
  {
    id: 'phone',
    header: 'Telefon',
    className: 'w-[150px]',
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  {
    id: 'actions',
    header: hiddenHeader('Aktionen'),
    className: 'w-[50px]',
    skeleton: <Skeleton className="size-8 rounded" />,
  },
];

/** Same frame as the loaded list; rows hover because loaded rows navigate. */
export function ClientsTableSkeleton({ count }: { count: number }) {
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-[20px] w-[120px]" />
            <Skeleton className="h-[18px] w-[70px] rounded-full" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Skeleton className="h-[16px] w-[160px]" />
            <Skeleton className="h-[16px] w-[100px]" />
          </div>
        </div>
        <Skeleton className="size-8 shrink-0 rounded" />
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={CLIENT_COLUMNS} />
          <TableBody>
            <SkeletonRows columns={CLIENT_COLUMNS} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}
