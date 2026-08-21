import { Skeleton } from '@/components/ui/skeleton';

export function AufgabenContentSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function AufgabenPageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-8 w-32" />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <AufgabenContentSkeleton />
      </div>
    </div>
  );
}
