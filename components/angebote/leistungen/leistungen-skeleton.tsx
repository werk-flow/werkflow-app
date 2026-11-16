'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonList, SkeletonTable } from '@/components/ui/skeleton-table';
import { LEISTUNG_COLUMNS } from './leistungen-columns';

// Content-only skeletons: the Angebote layout keeps the h1 and the area nav
// on screen. Client module because the columns live in the client table.

/** Toolbar, count and rows. Loaded rows open their prices, so skeleton rows hover too. */
export function LeistungenListSkeleton() {
  return (
    <>
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-8 w-full sm:w-48" />
          <Skeleton className="h-8 w-full sm:max-w-xs" />
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <SkeletonList interactive className="md:hidden" />
      <SkeletonTable columns={LEISTUNG_COLUMNS} interactive className="hidden md:block" />
    </>
  );
}

export function LeistungenPageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Leistungen werden geladen">
      <span className="sr-only">Leistungen werden geladen.</span>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <LeistungenListSkeleton />
    </div>
  );
}
