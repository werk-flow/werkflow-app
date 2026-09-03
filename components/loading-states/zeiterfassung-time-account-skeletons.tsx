import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable, type SkeletonColumn } from '@/components/ui/skeleton-table';

// Content-only skeletons for the Zeiterfassung subpages. The area layout keeps
// the header and `AreaNav` on screen, so each one mirrors only what its page
// renders below: the `h2` title, then cards or tables shaped like the data.

const NUMERIC_CELL = <Skeleton className="h-4 w-16" />;

const PERIOD_SUMMARY_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'month', header: 'Monat' },
  { id: 'target', header: 'Soll', skeleton: NUMERIC_CELL },
  { id: 'credited', header: 'Gewertet', skeleton: NUMERIC_CELL },
  { id: 'delta', header: 'Differenz', skeleton: NUMERIC_CELL },
  { id: 'state', header: 'Status', skeleton: <Skeleton className="h-4 w-20" /> },
];

const ACCOUNT_EVENT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'reason', header: 'Buchung', skeleton: <Skeleton className="h-4 w-48" /> },
  { id: 'date', header: 'Datum', skeleton: <Skeleton className="h-4 w-20" /> },
  { id: 'minutes', header: 'Minuten', skeleton: NUMERIC_CELL },
];

const PERIOD_LIST_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'month', header: 'Monat', skeleton: <Skeleton className="h-4 w-32" /> },
  { id: 'state', header: 'Status', skeleton: <Skeleton className="h-4 w-20" /> },
  { id: 'employees', header: 'Mitarbeitende', skeleton: NUMERIC_CELL },
  { id: 'findings', header: 'Hinweise', skeleton: NUMERIC_CELL },
  { id: 'open', header: '', className: 'w-20', skeleton: <Skeleton className="h-8 w-16" /> },
];

const PERIOD_RESULT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'employee', header: 'Mitarbeiter/in', skeleton: <Skeleton className="h-4 w-36" /> },
  { id: 'target', header: 'Soll', skeleton: NUMERIC_CELL },
  { id: 'credited', header: 'Gewertet', skeleton: NUMERIC_CELL },
  { id: 'delta', header: 'Differenz', skeleton: NUMERIC_CELL },
  { id: 'closing', header: 'Schlusssaldo', skeleton: NUMERIC_CELL },
  { id: 'source', header: 'Sollquelle', skeleton: <Skeleton className="h-4 w-20" /> },
];

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

export function TimeAccountSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-28 w-full rounded-lg" />
      <div className="space-y-3">
        <SectionTitle />
        <SkeletonTable columns={PERIOD_SUMMARY_COLUMNS} rows={4} />
      </div>
      <div className="space-y-3">
        <SectionTitle />
        <SkeletonTable columns={ACCOUNT_EVENT_COLUMNS} rows={4} />
      </div>
    </div>
  );
}

export function TimePeriodsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <SubpageTitle />
      <Skeleton className="h-32 w-full rounded-lg" />
      <SkeletonTable columns={PERIOD_LIST_COLUMNS} rows={5} />
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
        <SkeletonTable columns={PERIOD_RESULT_COLUMNS} rows={5} />
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
