import { Fragment, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable } from '@/components/ui/skeleton-table';
import { TIME_PERIOD_RESULT_COLUMNS } from '@/components/zeiterfassung/time-period-result-columns';

// Content-only skeletons for the Zeiterfassung subpages. The area layout keeps
// the header and `AreaNav` on screen, so each one mirrors only what its page
// renders below: the `h2` title, then cards or lists shaped like the data.
// The Zeitkonto and Perioden lists are header-less grid rows on their pages,
// not tables, so their placeholders repeat that row shape; only the period
// detail's Monatswerte is a table and shares its column definition.

function SubpageTitle() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

function SectionTitle() {
  return <Skeleton className="h-6 w-40" />;
}

/** The bordered list the Zeitkonto and Perioden pages render their rows in. */
function BorderedList({ count, children }: { count: number; children: ReactNode }) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-lg border bg-card">
      {Array.from({ length: count }, (_, index) => (
        <Fragment key={index}>{children}</Fragment>
      ))}
    </div>
  );
}

export function TimeAccountSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="space-y-3">
        <SectionTitle />
        <BorderedList count={4}>
          <div className="grid gap-2 border-b p-4 last:border-b-0 sm:grid-cols-5">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        </BorderedList>
      </div>
      <div className="space-y-3">
        <SectionTitle />
        <BorderedList count={4}>
          <div className="flex items-center justify-between gap-4 border-b p-4 last:border-b-0">
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-48 max-w-full" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        </BorderedList>
      </div>
    </div>
  );
}

export function TimePeriodsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-32 w-full rounded-lg" />
      <BorderedList count={5}>
        <div className="grid items-center gap-3 border-b p-4 last:border-b-0 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
      </BorderedList>
    </div>
  );
}

export function TimePeriodDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
      <div className="space-y-3">
        <SectionTitle />
        <SkeletonTable columns={TIME_PERIOD_RESULT_COLUMNS} rows={5} className="bg-card" />
      </div>
      <div className="space-y-3">
        <SectionTitle />
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

export function TimeAccountSettingsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-44 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}
