import { Skeleton } from '@/components/ui/skeleton';

export function MitarbeiterContentSkeleton() {
  return (
    <>
      {/* Four state tabs (Mitglieder, Einladungen, Teams, Qualifikationen) and the refresh control. */}
      <div className="mb-4 flex min-w-0 items-center justify-between gap-2">
        <div className="flex h-9 w-fit max-w-full items-center gap-1 overflow-hidden rounded-md bg-muted/50 p-0.5">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="size-8 shrink-0" />
      </div>

      <div className="hidden space-y-3 md:block">
        <div className="flex gap-4 border-b px-4 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-8" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        ))}
      </div>

      <div className="space-y-2 md:hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-16 rounded-full" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-3 rounded-full" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-8 w-8 rounded" />
          </div>
        ))}
      </div>
    </>
  );
}
