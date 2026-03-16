import { Skeleton } from '@/components/ui/skeleton';
import { ZeiterfassungDashboardSkeleton } from './zeiterfassung-dashboard-skeleton';

export function ZeiterfassungPageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header skeleton */}
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6 sm:py-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-9 w-40" />
      </header>

      {/* Content skeleton */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Skeleton className="h-10 w-[300px] mb-4" />
        <ZeiterfassungDashboardSkeleton />
      </div>
    </div>
  );
}

