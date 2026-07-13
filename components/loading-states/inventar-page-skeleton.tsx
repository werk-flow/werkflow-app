import { Skeleton } from '@/components/ui/skeleton';

export function InventarPageSkeleton(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b bg-card px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="mt-2 h-4 w-80 max-w-full" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border bg-background px-3 py-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-2 h-6 w-20" />
            </div>
          ))}
        </div>
      </header>
      <div className="flex-1 overflow-auto px-4 py-4 sm:px-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-24" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border bg-card">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="grid grid-cols-6 gap-4 border-b px-4 py-3">
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20 justify-self-end" />
              <Skeleton className="h-4 w-20 justify-self-end" />
              <Skeleton className="h-8 w-8 justify-self-end rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
