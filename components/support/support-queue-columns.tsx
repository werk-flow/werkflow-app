import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody } from '@/components/ui/table';

// The columns of support's queue, which the list and its skeleton share.

export const SUPPORT_QUEUE_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'sent', header: 'Gesendet', className: 'w-[140px]', skeleton: <Skeleton className="h-5 w-28" /> },
  {
    id: 'organization',
    header: 'Organisation',
    className: 'w-[18%]',
    skeleton: <Skeleton className="h-5 w-32" />,
  },
  { id: 'report', header: 'Meldung', skeleton: <Skeleton className="h-5 w-64" /> },
  {
    id: 'status',
    header: 'Status',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-[22px] w-24 rounded-full" />,
  },
  {
    id: 'bucket',
    header: 'Einordnung',
    className: 'w-[120px]',
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  {
    id: 'assignee',
    header: 'Zuständig',
    className: 'w-[150px]',
    skeleton: <Skeleton className="h-5 w-24" />,
  },
];

/** The filter row and the list frame, for the route's skeleton. */
export function SupportQueueSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-9 w-44" />
      </div>
      <SkeletonList count={5} interactive className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-[22px] w-24 rounded-full" />
          </div>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={SUPPORT_QUEUE_COLUMNS} />
          <TableBody>
            <SkeletonRows columns={SUPPORT_QUEUE_COLUMNS} rows={5} interactive />
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
