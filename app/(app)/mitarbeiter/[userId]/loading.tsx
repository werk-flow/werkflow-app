import { Skeleton } from '@/components/ui/skeleton';

export default function MitarbeiterDetailLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <div className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <div className="mb-2 flex items-center gap-1.5">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="size-3.5" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-48 sm:h-8" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="h-8 w-8 rounded" />
        </div>
        <Skeleton className="mt-1 h-4 w-40" />
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.5fr]">
          {/* Cards: stack on mobile, row on md+, back to stack on 2xl (sidebar) */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3 2xl:grid-cols-1">
            {/* Profile card */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <Skeleton className="mb-3 h-4 w-16" />
              <div className="grid gap-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid gap-0.5">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-5 w-full max-w-[200px]" />
                  </div>
                ))}
              </div>
            </div>

            {/* Status card */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <Skeleton className="mb-3 h-4 w-32" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-2.5 w-full rounded-full" />
                <Skeleton className="h-3 w-10 ml-auto" />
              </div>
            </div>

            {/* Anwesenheit placeholder card */}
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <Skeleton className="mb-3 h-4 w-36" />
              <div className="flex flex-col items-center justify-center py-4">
                <Skeleton className="size-8 rounded mb-2" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="mt-1 h-3 w-36" />
              </div>
            </div>
          </div>

          {/* Table: full-width below cards on md–xl, right column on 2xl */}
          <div className="space-y-4 md:col-span-3 2xl:col-span-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="size-4" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-8 w-32 rounded-md" />
            </div>
            {/* Status pills */}
            <div className="flex gap-1.5">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="h-6 w-28 rounded-full" />
            </div>
            {/* Search bar */}
            <Skeleton className="h-9 w-full rounded-md" />
            {/* Table skeleton */}
            <div className="rounded-lg border bg-card">
              <div className="border-b px-4 py-3">
                <div className="flex gap-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-20" />
                  ))}
                </div>
              </div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 border-b px-4 py-3 last:border-0"
                >
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 flex-1 max-w-[200px]" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
