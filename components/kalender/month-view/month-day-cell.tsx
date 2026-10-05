'use client';

import { PlainButton } from '@/components/ui/plain-button';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { MonthCellItem } from '@/lib/calendar/month-cell-items';
import { MONTH_MAX_VISIBLE_ITEMS, type MonthCell } from '@/lib/calendar/month-layout';

type MonthDayCellProps = {
  cell: MonthCell;
  /** The cell's position in its week, Monday first. */
  index: number;
  /** Holiday or closure label of the day. */
  label: string | undefined;
  items: MonthCellItem[];
  itemFor: (item: MonthCellItem, full: boolean) => React.JSX.Element;
  openMore: string | null;
  onOpenMore: (dateIso: string | null) => void;
  onOpenDay: (date: Date) => void;
  canAdd: boolean;
  onAdd: (dateIso: string) => void;
};

/**
 * One day of the month grid: the background grid cell, the date header
 * with its holiday label and „+", and the items with „+n mehr" in a popover.
 * The three parts are grid children of the week row, placed per column.
 */
export function MonthDayCell(props: MonthDayCellProps): React.JSX.Element {
  const { cell, index, label, items, itemFor, openMore, onOpenMore, onOpenDay, canAdd, onAdd } = props;
  const visible = items.slice(0, MONTH_MAX_VISIBLE_ITEMS);
  const hidden = items.length - visible.length;
  const cellDate = new Date(`${cell.date}T12:00:00`);
  return (
    <div className="contents">
      <div
        role="gridcell"
        data-month-cell={cell.date}
        data-in-month={cell.inMonth ? 'true' : 'false'}
        aria-label={`${formatRefusalDate(cell.date)}${label ? `, ${label}` : ''}${items.length ? `, ${items.length} ${items.length === 1 ? 'Eintrag' : 'Einträge'}` : ''}`}
        className={cn(
          'min-w-0 border-r border-calendar-grid',
          (cell.isWeekend || label) && 'bg-calendar-cell-off',
          cell.isToday && 'bg-calendar-today',
          cell.isPast && 'opacity-80',
        )}
        style={{ gridColumn: index + 1, gridRow: '1 / -1' }}
        onDoubleClick={() => onOpenDay(cellDate)}
      />
      <div
        className={cn(
          'group/cell relative z-[1] flex min-w-0 items-start gap-1 px-1.5 pt-1',
          !cell.inMonth && 'text-muted-foreground',
        )}
        style={{ gridColumn: index + 1, gridRow: 1 }}
      >
        <PlainButton
          type="button"
          data-month-day-number={cell.date}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-sm tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            cell.isToday &&
              'bg-calendar-planning-strong font-semibold text-calendar-planning-strong-foreground hover:bg-calendar-planning-strong',
          )}
          aria-label={`${formatRefusalDate(cell.date)} in der Tagesansicht öffnen`}
          onClick={() => onOpenDay(cellDate)}
        >
          {Number(cell.date.slice(8, 10))}
        </PlainButton>
        {label && (
          <span
            data-calendar-holiday=""
            className="pointer-events-none min-w-0 truncate pt-1 text-[11px] text-calendar-holiday-foreground"
            title={label}
          >
            {label}
          </span>
        )}
        {canAdd && (
          <PlainButton
            type="button"
            className="ml-auto rounded-md px-1 text-xs text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/cell:opacity-100"
            aria-label={`Termin am ${formatRefusalDate(cell.date)} planen`}
            onClick={() => onAdd(cell.date)}
          >
            +
          </PlainButton>
        )}
      </div>
      <div
        data-month-day={cell.date}
        className="relative z-[1] flex min-w-0 flex-col gap-0.5 px-1 pb-1"
        style={{ gridColumn: index + 1, gridRow: -2 }}
      >
        {visible.map((item) => itemFor(item, false))}
        {hidden > 0 && (
          <Popover open={openMore === cell.date} onOpenChange={(open) => onOpenMore(open ? cell.date : null)}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 justify-start px-1.5 text-xs text-muted-foreground"
              >
                +{hidden} mehr
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-72 space-y-1 p-2" data-month-day-popover={cell.date}>
              <p className="px-1 pb-1 text-sm font-medium">{formatRefusalDate(cell.date)}</p>
              {items.map((item) => itemFor(item, true))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
