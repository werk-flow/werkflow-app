import { Skeleton } from '@/components/ui/skeleton';

export function QualifikationenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function QualifikationenPageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <QualifikationenContentSkeleton />
      </div>
    </div>
  );
}
