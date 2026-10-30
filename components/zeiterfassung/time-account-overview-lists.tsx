import type { ReactElement } from 'react';

import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  SkeletonList,
  SkeletonTable,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { formatMinutes, formatPeriod } from '@/lib/time-accounts/presentation';
import type { TimeAccountOverview } from '@/lib/time-accounts/overview-queries';
import { formatBerlin } from '@/lib/utils';
import { TimePeriodStateBadge } from './time-period-list';

type AccountPeriod = TimeAccountOverview['periods'][number];
type AccountEvent = TimeAccountOverview['events'][number];

const MINUTES_CELL = <Skeleton className="h-4 w-16" />;

// One column definition per list for the Zeitkonto tables and their route
// skeleton. The rows open nothing, so neither they nor their skeletons hover.
const ACCOUNT_PERIOD_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'month', header: 'Monat', skeleton: <Skeleton className="h-5 w-28" /> },
  { id: 'target', header: 'Soll', skeleton: MINUTES_CELL },
  { id: 'credited', header: 'Gewertet', skeleton: MINUTES_CELL },
  { id: 'delta', header: 'Differenz', skeleton: MINUTES_CELL },
  { id: 'state', header: 'Status', skeleton: <Skeleton className="h-[22px] w-24 rounded-full" /> },
];

const ACCOUNT_EVENT_COLUMNS: readonly SkeletonColumn[] = [
  { id: 'reason', header: 'Grund', skeleton: <Skeleton className="h-5 w-48 max-w-full" /> },
  { id: 'date', header: 'Datum', className: 'w-[140px]', skeleton: <Skeleton className="h-4 w-24" /> },
  { id: 'minutes', header: 'Stunden', className: 'w-[120px]', skeleton: MINUTES_CELL },
];

const PERIOD_MINUTES: ReadonlyArray<{ label: string; minutes: (period: AccountPeriod) => number }> = [
  { label: 'Soll', minutes: (period) => period.targetMinutes },
  { label: 'Gewertet', minutes: (period) => period.creditedMinutes },
  { label: 'Differenz', minutes: (period) => period.deltaMinutes },
];

/** The employee's monthly results: a table from the tablet breakpoint, cards below it. */
export function TimeAccountPeriodList({ periods }: { periods: AccountPeriod[] }): ReactElement {
  if (periods.length === 0)
    return (
      <EmptyState
        title="Noch keine Monatsabschlüsse"
        description="Sobald das Büro einen Monat vorbereitet, stehen hier deine Monatswerte."
      />
    );
  return (
    <>
      <div className="space-y-2 md:hidden">
        {periods.map((period) => (
          <ListRow key={period.id} className="block space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium capitalize">{formatPeriod(period.startDate)}</p>
              <TimePeriodStateBadge state={period.state} />
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {PERIOD_MINUTES.map((item) => (
                <div key={item.label} className="contents">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="text-right tabular-nums">{formatMinutes(item.minutes(period))}</dd>
                </div>
              ))}
            </dl>
          </ListRow>
        ))}
      </div>
      <div className="hidden rounded-lg border bg-card md:block">
        <Table>
          <ColumnsTableHeader columns={ACCOUNT_PERIOD_COLUMNS} />
          <TableBody>
            {periods.map((period) => (
              <TableRow key={period.id}>
                <TableCell className="font-medium capitalize">{formatPeriod(period.startDate)}</TableCell>
                {PERIOD_MINUTES.map((item) => (
                  <TableCell key={item.label} className="tabular-nums">
                    {formatMinutes(item.minutes(period))}
                  </TableCell>
                ))}
                <TableCell>
                  <TimePeriodStateBadge state={period.state} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** The employee's account bookings: a table from the tablet breakpoint, cards below it. */
export function TimeAccountEventList({ events }: { events: AccountEvent[] }): ReactElement {
  if (events.length === 0)
    return (
      <EmptyState
        title="Noch keine Kontobewegungen"
        description="Korrekturen, Auszahlungen und verfallene Stunden deines Zeitkontos stehen hier."
      />
    );
  return (
    <>
      <div className="space-y-2 md:hidden">
        {events.map((event) => (
          <ListRow key={event.id} className="justify-between gap-4">
            <div className="min-w-0">
              <p className="font-medium">{event.reason}</p>
              <p className="text-sm text-muted-foreground">
                {formatBerlin(event.effectiveDate, 'numericDate')}
              </p>
            </div>
            <span className="shrink-0 font-medium tabular-nums">{formatMinutes(event.minutes)}</span>
          </ListRow>
        ))}
      </div>
      <div className="hidden rounded-lg border bg-card md:block">
        <Table>
          <ColumnsTableHeader columns={ACCOUNT_EVENT_COLUMNS} />
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">{event.reason}</TableCell>
                <TableCell>{formatBerlin(event.effectiveDate, 'numericDate')}</TableCell>
                <TableCell className="font-medium tabular-nums">{formatMinutes(event.minutes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** The month list's placeholder, from the same columns. */
export function TimeAccountPeriodListSkeleton(): ReactElement {
  return (
    <>
      <SkeletonList count={4} className="md:hidden">
        <div className="w-full space-y-2">
          <div className="flex items-center justify-between gap-2">
            {ACCOUNT_PERIOD_COLUMNS[0]?.skeleton}
            {ACCOUNT_PERIOD_COLUMNS.at(-1)?.skeleton}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {ACCOUNT_PERIOD_COLUMNS.slice(1, -1).map((column) => (
              <div key={column.id} className="contents">
                <span className="text-sm text-muted-foreground">{column.header}</span>
                <span className="justify-self-end">{column.skeleton}</span>
              </div>
            ))}
          </div>
        </div>
      </SkeletonList>
      <SkeletonTable columns={ACCOUNT_PERIOD_COLUMNS} rows={4} className="hidden bg-card md:block" />
    </>
  );
}

/** The booking list's placeholder, from the same columns. */
export function TimeAccountEventListSkeleton(): ReactElement {
  return (
    <>
      <SkeletonList count={4} className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          {ACCOUNT_EVENT_COLUMNS[0]?.skeleton}
          {ACCOUNT_EVENT_COLUMNS[1]?.skeleton}
        </div>
        {ACCOUNT_EVENT_COLUMNS[2]?.skeleton}
      </SkeletonList>
      <SkeletonTable columns={ACCOUNT_EVENT_COLUMNS} rows={4} className="hidden bg-card md:block" />
    </>
  );
}
