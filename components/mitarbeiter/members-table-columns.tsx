import { Skeleton } from '@/components/ui/skeleton';
import type { SkeletonColumn } from '@/components/ui/skeleton-table';

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
  header: '',
  className: 'w-[50px]',
  skeleton: <Skeleton className="size-8 rounded" />,
};

export function memberColumns(showActions: boolean): readonly SkeletonColumn[] {
  return showActions ? [...MEMBER_COLUMNS, MEMBER_ACTIONS_COLUMN] : MEMBER_COLUMNS;
}
