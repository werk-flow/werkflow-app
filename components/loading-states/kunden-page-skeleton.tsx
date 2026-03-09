import { Skeleton } from '@/components/ui/skeleton'

export function KundenPageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-7 w-24 sm:h-8 sm:w-32" />
        <Skeleton className="h-9 w-28 sm:w-44" />
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {/* Count + refresh row */}
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>

        {/* Table skeleton - Desktop */}
        <div className="hidden md:block">
          {/* Table header */}
          <div className="flex gap-4 border-b px-4 py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-8" />
          </div>

          {/* Table rows */}
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-8 rounded" />
            </div>
          ))}
        </div>

        {/* Card skeleton - Mobile */}
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
                  <Skeleton className="h-3 w-36" />
                  <Skeleton className="h-3 w-3 rounded-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-8 w-8 shrink-0 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
