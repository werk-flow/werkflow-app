import { Skeleton } from '@/components/ui/skeleton';
import {
  TimeAccountEventListSkeleton,
  TimeAccountPeriodListSkeleton,
} from '@/components/zeiterfassung/time-account-overview-lists';
import { TimePeriodListSkeleton } from '@/components/zeiterfassung/time-period-list';
import { TimePeriodResultsSkeleton } from '@/components/zeiterfassung/time-period-results';

// Content-only skeletons for the Zeiterfassung subpages. The area layout keeps
// the header and `AreaNav` on screen, so each one mirrors only what its page
// renders below: the `h2` title, then cards or lists shaped like the data.
// Every list renders its placeholder from its own column definition.

function SubpageTitle() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

function SectionTitleSkeleton() {
  return <Skeleton className="h-6 w-40" />;
}

export function TimeAccountSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="space-y-3">
        <SectionTitleSkeleton />
        <TimeAccountPeriodListSkeleton />
      </div>
      <div className="space-y-3">
        <SectionTitleSkeleton />
        <TimeAccountEventListSkeleton />
      </div>
    </div>
  );
}

export function TimePeriodsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-32 w-full rounded-lg" />
      <TimePeriodListSkeleton />
    </div>
  );
}

export function TimePeriodDetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
      <div className="space-y-3">
        <SectionTitleSkeleton />
        <TimePeriodResultsSkeleton />
      </div>
      <div className="space-y-3">
        <SectionTitleSkeleton />
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
