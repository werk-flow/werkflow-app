import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody } from '@/components/ui/table';

// The columns of „Meine Meldungen“, which the list and its skeleton share,
// and the skeleton itself. A module of its own, so the organization-switch
// overlay of the app shell carries the skeleton without the list.

export const REPORT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'number', header: 'Nr.', className: 'w-[72px]', skeleton: <Skeleton className="h-5 w-8" /> },
  { id: 'sent', header: 'Gesendet', className: 'w-[150px]', skeleton: <Skeleton className="h-5 w-28" /> },
  {
    id: 'status',
    header: 'Status',
    className: 'w-[140px]',
    skeleton: <Skeleton className="h-[22px] w-24 rounded-full" />,
  },
  { id: 'description', header: 'Beschreibung', skeleton: <Skeleton className="h-5 w-56" /> },
  { id: 'response', header: 'Antwort vom Support', skeleton: <Skeleton className="h-5 w-40" /> },
];

/** The same frame as the loaded list, for the route's skeleton. */
export function OwnProblemReportListSkeleton() {
  return (
    <>
      <SkeletonList count={4} className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-[22px] w-24 rounded-full" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={REPORT_COLUMNS} />
          <TableBody>
            <SkeletonRows columns={REPORT_COLUMNS} rows={4} />
          </TableBody>
        </Table>
      </div>
    </>
  );
}
