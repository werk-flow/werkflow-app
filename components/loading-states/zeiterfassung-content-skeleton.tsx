import { Skeleton } from '@/components/ui/skeleton';
import { ZeiterfassungDashboardSkeleton } from './zeiterfassung-dashboard-skeleton';

/** Suspense fallback inside the overview: the `h-9` state-tab strip and the dashboard. */
export function ZeiterfassungContentSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-9 w-[300px]" />
      <ZeiterfassungDashboardSkeleton />
    </div>
  );
}

/** The overview route's content while loading: the toolbar button slot above the content. */
export function ZeiterfassungOverviewSkeleton() {
  return (
    <>
      <div className="mb-4 flex items-center justify-end">
        <Skeleton className="h-9 w-40" />
      </div>
      <ZeiterfassungContentSkeleton />
    </>
  );
}
