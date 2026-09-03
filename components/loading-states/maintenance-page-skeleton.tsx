"use client";

import { ServiceToolbarSkeleton } from "@/components/loading-states/service-cases-page-skeleton";
import { MAINTENANCE_DUE_COLUMNS } from "@/components/service/maintenance-content";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton-table";

/**
 * Search, the three in-page tabs, and the due list. Due rows carry their own
 * action buttons and do nothing on click, so nothing here hovers.
 */
export function MaintenanceContentSkeleton() {
  return (
    <>
      <Skeleton className="h-9 w-full" />
      <div className="space-y-4">
        <div className="inline-flex h-9 items-center gap-1 rounded-md bg-muted/50 p-0.5">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-32" />
        </div>
        <SkeletonList className="md:hidden" />
        <SkeletonTable
          columns={MAINTENANCE_DUE_COLUMNS}
          className="hidden shadow-xs md:block"
        />
      </div>
    </>
  );
}

export function MaintenancePageSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Wartung wird geladen">
      <span className="sr-only">Wartung wird geladen.</span>
      <ServiceToolbarSkeleton
        actions={
          <div className="flex gap-2">
            <Skeleton className="h-9 w-44" />
            <Skeleton className="h-9 w-48" />
          </div>
        }
      />
      <MaintenanceContentSkeleton />
    </div>
  );
}
