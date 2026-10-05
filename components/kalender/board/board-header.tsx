'use client';

import { cn } from '@/lib/utils';
import { WEEKDAY_SHORT, type BoardColumn } from '@/lib/calendar/board-layout';
import { formatRefusalDate } from '@/lib/calendar/messages';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';
import { BOARD_COLUMN_MIN_PX, BOARD_NAME_COLUMN_PX } from './types';

/** The Plantafel's sticky header row: the name column and one header per day with its holiday label. */
export function BoardHeader({
  columns,
  scrollable,
  labels,
}: {
  columns: BoardColumn[];
  scrollable: boolean;
  labels: ReadonlyMap<string, string>;
}): React.JSX.Element {
  return (
    <div
      role="row"
      className={cn('sticky top-0 grid bg-background', CALENDAR_LAYER_CLASS.sticky)}
      style={{
        gridTemplateColumns: `${BOARD_NAME_COLUMN_PX}px repeat(${columns.length}, minmax(${scrollable ? BOARD_COLUMN_MIN_PX : 0}px, 1fr))`,
      }}
    >
      <div
        role="columnheader"
        className={cn(
          'sticky left-0 flex items-end border-b border-r border-calendar-grid-strong bg-calendar-gutter px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground',
          CALENDAR_LAYER_CLASS.sticky,
        )}
      >
        Mitarbeiter
      </div>
      {columns.map((column) => {
        const label = labels.get(column.date);
        return (
          <div
            key={column.date}
            role="columnheader"
            data-board-column={column.date}
            className={cn(
              'relative flex min-w-0 flex-col items-center justify-end gap-0.5 border-b border-r border-calendar-grid px-1 pb-1 pt-1.5',
              (column.isWeekend || label) && 'bg-calendar-cell-off',
              column.isToday && 'bg-calendar-today',
            )}
            title={label ?? undefined}
          >
            <span className="text-[11px] uppercase text-muted-foreground">
              {WEEKDAY_SHORT[column.weekday]}
            </span>
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-sm tabular-nums',
                column.isToday
                  ? 'bg-calendar-planning-strong font-semibold text-calendar-planning-strong-foreground'
                  : 'font-medium',
              )}
            >
              {Number(column.date.slice(8, 10))}
            </span>
            {label && (
              <span
                className="max-w-full truncate text-[11px] text-calendar-holiday-foreground"
                aria-label={`${formatRefusalDate(column.date)}: ${label}`}
              >
                {label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
