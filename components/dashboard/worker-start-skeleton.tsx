import type { ReactElement } from 'react';

import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';

// The boxes of the field worker's start page (worker-start-sections.tsx): a
// section title, then its rows with the same row classes and hover.

const EINSATZ_ROWS = [0, 1] as const;

/** Two Einsätze while the phone reads its day. */
export function EinsaetzeSkeleton(): ReactElement {
  return (
    <div className="space-y-3" data-testid="worker-start-einsaetze-loading">
      {EINSATZ_ROWS.map((key) => (
        <ListRow key={key} skeleton interactive>
          <div className="w-full space-y-1.5 py-0.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
        </ListRow>
      ))}
    </div>
  );
}

function SectionSkeleton({ children }: { children: ReactElement }): ReactElement {
  return (
    <div className="space-y-3">
      <Skeleton className="h-5 w-36" />
      {children}
    </div>
  );
}

/** The whole start page while its code loads. */
export function WorkerStartSkeleton(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl space-y-6" aria-hidden="true">
      <SectionSkeleton>
        <EinsaetzeSkeleton />
      </SectionSkeleton>
      <SectionSkeleton>
        <ListRow skeleton interactive>
          <div className="w-full space-y-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-40" />
          </div>
        </ListRow>
      </SectionSkeleton>
      <SectionSkeleton>
        <ListRow skeleton interactive>
          <Skeleton className="h-5 w-32" />
        </ListRow>
      </SectionSkeleton>
    </div>
  );
}
