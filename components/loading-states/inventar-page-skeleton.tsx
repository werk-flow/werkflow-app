import { INVENTORY_ITEM_COLUMNS } from '@/components/inventar/inventory-table-columns';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonTable } from '@/components/ui/skeleton-table';

// Mirrors `InventoryContent`: page header with three actions, four summary
// tiles, the tab strip with filters, then the item list. Item rows do nothing
// on click, so neither the table nor the card skeletons are interactive.
export function InventarPageSkeleton(): React.JSX.Element {
  return (
    <PageShell>
      <header className="shrink-0 border-b bg-background px-4 pt-3 sm:px-6 sm:pt-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3 sm:pb-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-7 w-32 sm:h-8" />
            <Skeleton className="mt-1.5 h-4 w-64 max-w-full" />
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
      </header>

      <PageBody>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border bg-card px-3 py-3">
              <Skeleton className="h-4 w-28 max-w-full" />
              <Skeleton className="mt-2 h-6 w-20" />
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Skeleton className="h-9 w-80 max-w-full" />
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <Skeleton className="h-9 md:w-64" />
            <Skeleton className="h-9 md:w-44" />
            <Skeleton className="h-9 md:w-40" />
            <Skeleton className="h-9 md:w-44" />
          </div>
        </div>

        <SkeletonList count={6} className="mt-4 md:hidden" />
        <SkeletonTable columns={INVENTORY_ITEM_COLUMNS} rows={9} className="mt-4 hidden bg-card md:block" />
      </PageBody>
    </PageShell>
  );
}
