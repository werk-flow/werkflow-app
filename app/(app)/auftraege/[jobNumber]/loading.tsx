import { Skeleton } from '@/components/ui/skeleton';

export default function JobDetailLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <div className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="size-3.5" />
          <Skeleton className="h-4 w-24" />
        </div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-48 sm:h-8" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-8 w-8" />
        </div>
      </div>

      {/* Two-column layout skeleton */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Left column */}
          <div className="space-y-6">
            {/* Metadata card */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <Skeleton className="mb-3 h-4 w-20" />
              <div className="grid gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="grid gap-0.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-5 w-full max-w-[200px]" />
                  </div>
                ))}
              </div>
            </div>
            {/* Client card */}
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-5" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            </div>
            {/* Employees section */}
            <div className="rounded-lg border bg-card p-4">
              <Skeleton className="mb-3 h-5 w-40" />
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-16 rounded-full" />
                </div>
              ))}
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-6">
            {/* Project link */}
            <div className="rounded-lg border bg-card p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="size-5" />
                <div className="space-y-1">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
            {/* Placeholders */}
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
