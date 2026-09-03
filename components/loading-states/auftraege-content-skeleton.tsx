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

      <div className="hidden md:block">
        <div className="flex gap-4 border-b px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-8" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        ))}
      </div>

      <div className="space-y-2 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
          >
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
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-8 w-8 shrink-0 rounded" />
          </div>
        ))}
      </div>
    </>
  );
}
