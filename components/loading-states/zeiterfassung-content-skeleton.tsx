import { Skeleton } from '@/components/ui/skeleton';
import { ZeiterfassungDashboardSkeleton } from './zeiterfassung-dashboard-skeleton';

export function ZeiterfassungContentSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-10 w-[300px]" />
      <ZeiterfassungDashboardSkeleton />
    </div>
  );
}
