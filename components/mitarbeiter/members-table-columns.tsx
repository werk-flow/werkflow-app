import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  hiddenHeader,
  SkeletonList,
  SkeletonRows,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody } from '@/components/ui/table';

// The status cells' skeletons double as their loading state in the live table.
export const STATUS_SKELETON = <Skeleton className="h-[22px] w-24 rounded-full" />;
export const PROGRESS_SKELETON = (
  <div className="flex items-center gap-2 min-w-[100px]">
    <Skeleton className="h-2 flex-1" />
    <Skeleton className="h-4 w-8" />
  </div>
);

// One column definition for the loaded table and its skeleton (design canon):
// header count, widths and hover cannot drift apart. The actions column is
// appended only for managers, see `memberColumns`.
const MEMBER_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'name',
    header: 'Name',
    className: 'w-[18%]',
    skeleton: <Skeleton className="h-5 w-28" />,
  },
  { id: 'email', header: 'E-Mail', skeleton: <Skeleton className="h-5 w-48" /> },
  {
    id: 'role',
    header: 'Rolle',
    className: 'w-[120px] px-4',
    skeleton: <Skeleton className="h-[22px] w-20 rounded-full" />,
  },
  {
    id: 'status',
    header: 'Status',
    className: 'w-[150px] px-4',
    skeleton: STATUS_SKELETON,
  },
  {
    id: 'progress',
    header: 'Tagesfortschritt',
    className: 'w-[150px] px-4',
    skeleton: PROGRESS_SKELETON,
  },
  {
    id: 'joined',
    header: 'Beigetreten',
    className: 'w-[120px]',
    skeleton: <Skeleton className="h-5 w-20" />,
  },
];

const MEMBER_ACTIONS_COLUMN: SkeletonColumn = {
  id: 'actions',
  header: hiddenHeader('Aktionen'),
  className: 'w-[50px]',
  skeleton: <Skeleton className="size-8 rounded" />,
};

export function memberColumns(showActions: boolean): readonly SkeletonColumn[] {
  return showActions ? [...MEMBER_COLUMNS, MEMBER_ACTIONS_COLUMN] : MEMBER_COLUMNS;
}

// Here, not beside the table: the route skeleton loads with the app shell, so it
// must not pull the live table, its menus and dialogs into every page.
/** Same frame as the loaded list; rows hover because loaded rows navigate. */
export function MembersTableSkeleton({ count, showActions }: { count: number; showActions: boolean }) {
  return (
    <>
      <SkeletonList count={count} interactive className="md:hidden">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-[20px] w-[120px]" />
            <Skeleton className="h-[18px] w-[70px] rounded-full" />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Skeleton className="h-[16px] w-[160px]" />
            <Skeleton className="h-[16px] w-[100px]" />
          </div>
        </div>
        {showActions && <Skeleton className="size-8 rounded shrink-0" />}
      </SkeletonList>
      <div className="hidden md:block">
        <Table>
          <ColumnsTableHeader columns={memberColumns(showActions)} />
          <TableBody>
            <SkeletonRows columns={memberColumns(showActions)} rows={count} interactive />
          </TableBody>
        </Table>
      </div>
    </>
  );
}
