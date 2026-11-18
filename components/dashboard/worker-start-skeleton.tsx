import type { ReactElement } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

// The boxes of the field worker's start page (worker-start-sections.tsx): a
// section title, then its rows in the rows' own box.

/**
 * A start page row: a registry `Button` link drawn as a card row, with the field worker's 44 px
 * target. Not `ListRow`: list-row.tsx in this page's chunks regroups the app shell's shared
 * chunks into one more script on every cold start (lab.field.cold-start).
 */
export const START_ROW_CLASS =
  'h-auto w-full justify-between gap-3 whitespace-normal rounded-lg bg-card px-3 py-2.5 text-left font-normal';

/** The box of one row while it loads: the row's border and padding, without its hover. */
const ROW_BOX_CLASS = 'flex items-center rounded-lg border bg-card px-3 py-2.5';

const EINSATZ_ROWS = [0, 1] as const;

/** Two Einsätze while the phone reads its day. */
export function EinsaetzeSkeleton(): ReactElement {
  return (
    <div className="space-y-3" data-testid="worker-start-einsaetze-loading">
      {EINSATZ_ROWS.map((key) => (
        <div key={key} className={ROW_BOX_CLASS} aria-hidden="true">
          <div className="w-full space-y-1.5 py-0.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
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
        <div className={ROW_BOX_CLASS}>
          <div className="w-full space-y-1">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
      </SectionSkeleton>
      <SectionSkeleton>
        <div className={ROW_BOX_CLASS}>
          <Skeleton className="h-5 w-32" />
        </div>
      </SectionSkeleton>
    </div>
  );
}
