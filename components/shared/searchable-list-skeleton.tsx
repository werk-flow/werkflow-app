import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonTable, type SkeletonColumn } from '@/components/ui/skeleton-table';

/**
 * A searchable list's toolbar, count and rows. Loaded rows open their record,
 * so skeleton rows hover too.
 */
export function SearchableListSkeleton({ columns }: { columns: readonly SkeletonColumn[] }) {
  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-full sm:w-48" />
          <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:justify-end">
            <Skeleton className="h-8 min-w-0 flex-1 sm:max-w-xs" />
            <Skeleton className="size-8" />
          </div>
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <SkeletonList interactive className="md:hidden" />
      <SkeletonTable columns={columns} interactive className="hidden md:block" />
    </>
  );
}
