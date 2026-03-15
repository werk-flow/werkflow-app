import { Skeleton } from '@/components/ui/skeleton';

export function KalenderContentSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold sm:text-2xl">Kalender</h1>
          <div className="flex items-center gap-1">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 w-16 ml-2" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-9 w-40" />
        </div>
      </header>

      <div className="border-b px-4 py-2 sm:px-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-[340px]" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="sticky top-0 z-10 bg-background border-b">
          <div className="flex">
            <div className="w-48 shrink-0 border-r bg-muted/30 px-3 py-2">
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex-1 h-8 bg-muted/10" />
          </div>
        </div>
        <div className="divide-y">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex border-b">
              <div className="w-48 shrink-0 border-r px-3 py-4 space-y-2">
                <Skeleton className="h-5 w-28" />
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
              <div className="flex-1 h-20 p-2">
                <Skeleton className="h-14 w-[200px] rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
