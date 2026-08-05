import { Skeleton } from '@/components/ui/skeleton';

export default function AnfragenLoading() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b bg-background px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="text-xl font-bold sm:text-2xl">Anfragen</h1>
        <Skeleton className="h-9 w-28 sm:w-40" />
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-8 w-64" />
          </div>
          <Skeleton className="h-5 w-24" />
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
