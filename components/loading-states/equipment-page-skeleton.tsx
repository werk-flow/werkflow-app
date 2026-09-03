"use client";

import { ServiceToolbarSkeleton } from "@/components/loading-states/service-cases-page-skeleton";
import { EQUIPMENT_COLUMNS } from "@/components/service/equipment-list-content";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton-table";

/** Filter strip and rows. Loaded rows are links, so skeleton rows hover too. */
export function EquipmentListSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-full md:w-64" />
        <Skeleton className="h-9 w-full md:w-36" />
      </div>
      <SkeletonList interactive className="md:hidden" />
      <SkeletonTable
        columns={EQUIPMENT_COLUMNS}
        interactive
        className="hidden shadow-xs md:block"
      />
    </div>
  );
}

export function EquipmentPageSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Anlagen und Geräte werden geladen"
    >
      <span className="sr-only">Anlagen und Geräte werden geladen.</span>
      <ServiceToolbarSkeleton
        actions={<Skeleton className="hidden h-9 w-40 md:block" />}
      />
      <EquipmentListSkeleton />
    </div>
  );
}

export function EquipmentDetailSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Anlage wird geladen"
    >
      <span className="sr-only">Anlage wird geladen.</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-56 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
