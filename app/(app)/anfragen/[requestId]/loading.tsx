import { Skeleton } from '@/components/ui/skeleton';

export default function AnfrageDetailLoading() {
  return (
    <div className="flex h-full flex-col overflow-auto p-4 sm:p-6">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <Skeleton className="h-8 w-44" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-8 w-96 max-w-full" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </div>
  );
}
