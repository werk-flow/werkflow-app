import type { ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/** The completed-visit rows of the Wartung page while they load: visit, plan and the report actions. */
export function ServiceReportListSkeleton(): ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border shadow-xs">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0">
          <span className="block space-y-1.5">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-24 max-w-full" />
          </span>
          <Skeleton className="h-8 w-40" />
        </div>
      ))}
    </div>
  );
}
