import { Skeleton } from '@/components/ui/skeleton';

export function ZeiterfassungDashboardSkeleton() {
  return (
    <div className="space-y-6 pb-32">
      <div className="flex flex-col items-center py-8">
        <Skeleton className="h-[260px] w-[260px] rounded-full" />
        <Skeleton className="mt-6 h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-40" />
        <div className="mt-4 flex gap-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
        ))}
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-[120px] w-full rounded-lg" />
      </div>
    </div>
  );
}
