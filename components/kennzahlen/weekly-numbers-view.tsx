import { BarChart3 } from 'lucide-react';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { Skeleton } from '@/components/ui/skeleton';
import { hiddenHeader, type SkeletonColumn } from '@/components/ui/skeleton-table';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import {
  WEEKLY_NUMBER_SECTIONS,
  weekLabel,
  type WeeklyCell,
  type WeeklyNumbers,
} from '@/lib/weekly-numbers/format';

const WEEK_COUNT = 12;
const LABEL_COLUMN_CLASS = 'min-w-56';
const WEEK_COLUMN_CLASS = 'h-auto py-2 text-right';

/** The table's columns: the label, then one column per week, the running week first. */
export const WEEKLY_NUMBER_COLUMNS: readonly SkeletonColumn[] = [
  {
    id: 'kennzahl',
    header: 'Kennzahl',
    className: LABEL_COLUMN_CLASS,
    skeleton: <Skeleton className="h-4 w-44" />,
  },
  ...Array.from({ length: WEEK_COUNT }, (_, index) => ({
    id: `woche-${index}`,
    header: hiddenHeader('Woche'),
    className: WEEK_COLUMN_CLASS,
    skeleton: <Skeleton className="ml-auto h-4 w-8" />,
  })),
];

/** The rows of the table, section headings included, for its skeleton. */
export const WEEKLY_NUMBER_ROW_COUNT = WEEKLY_NUMBER_SECTIONS.reduce(
  (total, section) => total + 1 + section.rows.length,
  0,
);

/** Whether no number of any week has anything to show yet. */
function hasNoNumbers(weeks: readonly WeeklyNumbers[]): boolean {
  return weeks.every(
    (week) =>
      Object.values(week.overdue).every((value) => value === 0) &&
      week.handover.released === 0 &&
      week.workReports.finished === 0 &&
      week.timeCapture.entries === 0,
  );
}

function CellValue({ cell, strong }: { cell: WeeklyCell; strong?: boolean | undefined }): ReactElement {
  return (
    <span className="inline-flex flex-col items-end whitespace-nowrap tabular-nums">
      <span className={cn(strong && 'font-semibold')}>{cell.value}</span>
      {cell.detail ? <span className="text-xs text-muted-foreground">{cell.detail}</span> : null}
    </span>
  );
}

function WeekHeading({ week, running }: { week: WeeklyNumbers; running: boolean }): ReactElement {
  const label = weekLabel(week);
  return (
    <span className="inline-flex flex-col items-end">
      <span className="font-medium text-foreground">{label.title}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {running ? `${label.range} bis jetzt` : label.range}
      </span>
    </span>
  );
}

/**
 * Desktop: the numbers as rows, the weeks side by side, the running week next
 * to the labels, so it stays in view when the table scrolls inside its region.
 */
function WeeklyNumbersTable({ weeks }: { weeks: readonly WeeklyNumbers[] }): ReactElement {
  const newestFirst = weeks.toReversed();
  return (
    <div className="hidden md:block">
      <Table scrollLabel="Wochenzahlen der letzten 12 Wochen">
        <TableHeader>
          <TableRow>
            {WEEKLY_NUMBER_COLUMNS.map((column, index) => {
              const week = index === 0 ? undefined : newestFirst[index - 1];
              return (
                <TableHead key={column.id} className={column.className}>
                  {week ? <WeekHeading week={week} running={index === 1} /> : column.header}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        {WEEKLY_NUMBER_SECTIONS.map((section) => (
          <TableBody key={section.id}>
            <TableRow className="bg-muted/50">
              <TableHead scope="rowgroup" colSpan={weeks.length + 1} className="h-auto py-2">
                <span className="block font-medium text-foreground">{section.title}</span>
                <span className="block text-xs font-normal text-muted-foreground">{section.hint}</span>
              </TableHead>
            </TableRow>
            {section.rows.map((row) => (
              <TableRow key={row.id}>
                <TableHead
                  scope="row"
                  className={cn('h-auto py-2 font-normal text-foreground', row.total && 'font-semibold')}
                >
                  {row.label}
                </TableHead>
                {newestFirst.map((week) => (
                  <TableCell key={week.weekStart} className="text-right">
                    <CellValue cell={row.cell(week)} strong={row.total} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        ))}
      </Table>
    </div>
  );
}

/** Phone: one card per week, the running week first, with every number of the table. */
function WeeklyNumbersCards({ weeks }: { weeks: readonly WeeklyNumbers[] }): ReactElement {
  const lastIndex = weeks.length - 1;
  return (
    <div className="space-y-3 md:hidden">
      {weeks
        .map((week, index) => ({ week, running: index === lastIndex }))
        .toReversed()
        .map(({ week, running }) => {
          const label = weekLabel(week);
          return (
            <ListRow key={week.weekStart} className="block space-y-3" rowId={week.weekStart}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">
                  {label.title} <span className="font-normal text-muted-foreground">· {label.range}</span>
                </h3>
                {running ? <Badge variant="outline">Bis jetzt</Badge> : null}
              </div>
              {WEEKLY_NUMBER_SECTIONS.map((section) => (
                <section key={section.id} className="space-y-1 border-t pt-2">
                  <p className="text-xs font-medium text-muted-foreground">{section.title}</p>
                  <dl className="space-y-1 text-sm">
                    {section.rows.map((row) => (
                      <div key={row.id} className="flex items-start justify-between gap-3">
                        <dt className={cn(row.total && 'font-semibold')}>{row.label}</dt>
                        <dd>
                          <CellValue cell={row.cell(week)} strong={row.total} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </ListRow>
          );
        })}
    </div>
  );
}

/**
 * The company's weekly numbers. Every number counts the whole organization;
 * the view has no person, filter or drill-down.
 */
export function WeeklyNumbersView({ weeks }: { weeks: readonly WeeklyNumbers[] }): ReactElement {
  if (hasNoNumbers(weeks)) {
    return (
      <EmptyState
        icon={BarChart3}
        title="Noch keine Wochenzahlen"
        description="Die Zahlen entstehen aus Anfragen, Aufträgen, Übergaben und Zeiten, sobald dein Team in WerkFlow arbeitet."
      />
    );
  }
  return (
    <>
      <WeeklyNumbersCards weeks={weeks} />
      <WeeklyNumbersTable weeks={weeks} />
    </>
  );
}
