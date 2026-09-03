"use client";

import type { ReactNode } from "react";

import { SERVICE_CASE_COLUMNS } from "@/components/service/service-case-list-content";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton-table";

// Content-only skeletons: the service layout keeps the h1 and the area nav on
// screen, so these mirror what a subpage renders below it. Client module
// because the column definitions live in the client list components.

/** The subpage toolbar: h2 and description on the left, the primary action on the right. */
export function ServiceToolbarSkeleton({
  actions = <Skeleton className="hidden h-9 w-44 md:block" />,
}: {
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {actions}
    </div>
  );
}

/** Filter strip and rows. Loaded rows are links, so skeleton rows hover too. */
export function ServiceCaseListSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-full md:w-60" />
      </div>
      <SkeletonList interactive className="md:hidden" />
      <SkeletonTable
        columns={SERVICE_CASE_COLUMNS}
        interactive
        className="hidden shadow-xs md:block"
      />
    </>
  );
}

export function ServiceCasesPageSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Servicefälle werden geladen"
    >
      <span className="sr-only">Servicefälle werden geladen.</span>
      <ServiceToolbarSkeleton />
      <ServiceCaseListSkeleton />
    </div>
  );
}

export function ServiceCaseDetailSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Servicefall wird geladen"
    >
      <span className="sr-only">Servicefall wird geladen.</span>
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}
