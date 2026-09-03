import { AuftraegeTableSkeleton } from '@/components/auftraege/unified-auftraege-table';
import { Skeleton } from '@/components/ui/skeleton';

export function AuftraegeContentSkeleton() {
  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </div>
        <Skeleton className="h-8 w-8 rounded" />
      </div>

      <AuftraegeTableSkeleton count={5} showActions />
    </>
  );
}
