import Link from 'next/link';
import type { ReactElement } from 'react';
import { CalendarRange } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ColumnsTableHeader,
  hiddenHeader,
  SkeletonList,
  SkeletonTable,
  type SkeletonColumn,
} from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import {
  formatPeriod,
  PERIOD_STATE_BADGE_VARIANTS,
  PERIOD_STATE_LABELS,
  type TimePeriodState,
} from '@/lib/time-accounts/presentation';
import type { TimePeriodListItem } from '@/lib/time-accounts/queries';
import { formatGermanDate } from '@/lib/utils';

// One column definition for the period table and its route skeleton. A row
// opens its period through its own „Öffnen“ link, so neither the rows nor
// their skeletons hover.
const TIME_PERIOD_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'period',
    header: 'Monat',
    skeleton: (
      <span className="block space-y-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-40" />
      </span>
    ),
  },
  { id: 'state', header: 'Status', skeleton: <Skeleton className="h-[22px] w-24 rounded-full" /> },
  { id: 'employees', header: 'Mitarbeitende', skeleton: <Skeleton className="h-4 w-12" /> },
  { id: 'findings', header: 'Prüfhinweise', skeleton: <Skeleton className="h-4 w-28" /> },
  {
    id: 'open',
    header: hiddenHeader('Öffnen'),
    className: 'w-[100px]',
    skeleton: <Skeleton className="h-8 w-16" />,
  },
];

function PeriodRange({ period }: { period: TimePeriodListItem }): ReactElement {
  return (
    <>
      <span className="block font-medium capitalize">{formatPeriod(period.startDate)}</span>
      <span className="block text-xs text-muted-foreground">
        {formatGermanDate(period.startDate)} – {formatGermanDate(period.endDate)}
      </span>
    </>
  );
}

/** A period's state as its badge: yellow while it waits for the close, green once closed. */
export function TimePeriodStateBadge({ state }: { state: TimePeriodState }): ReactElement {
  return <Badge variant={PERIOD_STATE_BADGE_VARIANTS[state]}>{PERIOD_STATE_LABELS[state]}</Badge>;
}

function findingText(period: TimePeriodListItem): string {
  const count = `${period.findingCount} ${period.findingCount === 1 ? 'Hinweis' : 'Hinweise'}`;
  return period.blockingCount > 0 ? `${count} · ${period.blockingCount} blockierend` : count;
}

function OpenPeriodLink({ period }: { period: TimePeriodListItem }): ReactElement {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href={`/zeiterfassung/perioden/${period.id}`}>Öffnen</Link>
    </Button>
  );
}

/** The office's period list: a table from the tablet breakpoint, cards below it. */
export function TimePeriodList({ periods }: { periods: TimePeriodListItem[] }): ReactElement {
  if (periods.length === 0)
    return (
      <EmptyState
        icon={CalendarRange}
        title="Noch keine Perioden"
        description="Bereite oben den ersten Monat vor. Danach prüfst du ihn hier und schließt ihn für die Lohnabrechnung ab."
      />
    );
  return (
    <>
      <div className="space-y-2 md:hidden">
        {periods.map((period) => (
          <ListRow key={period.id} className="items-start">
            <div className="min-w-0 flex-1 space-y-1.5">
              <PeriodRange period={period} />
              <TimePeriodStateBadge state={period.state} />
              <p className="text-sm">{period.employeeCount} Mitarbeitende</p>
              <p className="text-sm text-muted-foreground">{findingText(period)}</p>
            </div>
            <OpenPeriodLink period={period} />
          </ListRow>
        ))}
      </div>
      <div className="hidden rounded-lg border bg-card md:block">
        <Table>
          <ColumnsTableHeader columns={TIME_PERIOD_COLUMNS} />
          <TableBody>
            {periods.map((period) => (
              <TableRow key={period.id}>
                <TableCell>
                  <PeriodRange period={period} />
                </TableCell>
                <TableCell>
                  <TimePeriodStateBadge state={period.state} />
                </TableCell>
                <TableCell className="tabular-nums">{period.employeeCount}</TableCell>
                <TableCell>{findingText(period)}</TableCell>
                <TableCell className="text-right">
                  <OpenPeriodLink period={period} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/** The period list's placeholder, from the same columns. */
export function TimePeriodListSkeleton(): ReactElement {
  return (
    <>
      <SkeletonList count={5} className="md:hidden">
        <div className="min-w-0 flex-1 space-y-1.5">
          {TIME_PERIOD_COLUMNS.slice(0, -1).map((column) => (
            <div key={column.id}>{column.skeleton}</div>
          ))}
        </div>
        <Skeleton className="h-8 w-16 shrink-0" />
      </SkeletonList>
      <SkeletonTable columns={TIME_PERIOD_COLUMNS} rows={5} className="hidden bg-card md:block" />
    </>
  );
}
