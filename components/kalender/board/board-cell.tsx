'use client';

import { memo } from 'react';
import { CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveCapacityState, describeCapacity, formatShortHours, type CalendarBoardDay, type CalendarBoardRow, type CapacityState } from '@/lib/calendar/board';
import type { BoardColumn } from '@/lib/calendar/board-layout';
import { WEEKDAY_SHORT } from '@/lib/calendar/board-layout';
import { formatRefusalDate } from '@/lib/calendar/messages';
import type { CalendarSurfaceActions } from './types';

const CAPACITY_CLASS: Record<CapacityState, string> = {
  off: '',
  free: 'text-muted-foreground',
  partial: 'text-muted-foreground',
  full: 'bg-calendar-capacity-full text-calendar-capacity-full-foreground',
  overbooked: 'bg-calendar-capacity-over text-calendar-capacity-over-foreground',
};

export type BoardCellProps = {
  column: BoardColumn;
  columnIndex: number;
  rowIndex: number;
  row: CalendarBoardRow | null;
  day: CalendarBoardDay | undefined;
  plannedMinutes: number;
  actual: { minutes: number; pending: boolean } | undefined;
  compact: boolean;
  actions: CalendarSurfaceActions;
  employed: boolean;
};

/**
 * One person-day (P1-24a, criterion 6): the background tells the day's
 * nature (weekend, holiday, closure, absence, today), the corner tells the
 * capacity, the strip at the bottom tells recorded time when the toggle is
 * on, and one quiet button opens the create dialog for this person and day.
 */
export const BoardCell = memo(function BoardCell({ column, columnIndex, rowIndex, row, day, plannedMinutes, actual, compact, actions, employed }: BoardCellProps) {
  const state: CapacityState = day ? deriveCapacityState(day, plannedMinutes) : plannedMinutes > 0 ? 'partial' : 'free';
  const off = !employed || (day ? day.targetMinutes === 0 && plannedMinutes === 0 : column.isWeekend);
  const description = !employed ? 'Nicht beschäftigt' : day ? describeCapacity(day, plannedMinutes) : column.isWeekend ? 'Wochenende' : '';
  const dateLabel = `${WEEKDAY_SHORT[column.weekday]} ${formatRefusalDate(column.date)}`;
  const canAdd = actions.isManager && employed;
  return (
    <div
      role="gridcell"
      tabIndex={rowIndex === 0 && columnIndex === 0 ? 0 : -1}
      data-board-cell=""
      data-row-index={rowIndex}
      data-column-index={columnIndex}
      data-date={column.date}
      data-capacity={row ? state : undefined}
      aria-label={`${row ? `${row.displayName}, ` : ''}${dateLabel}${description ? `: ${description}` : ''}`}
      className={cn(
        'group/cell relative min-w-0 border-b border-r border-calendar-grid outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        off ? 'bg-calendar-cell-off' : column.isToday ? 'bg-calendar-today' : 'bg-background',
        day?.reason === 'holiday' || day?.reason === 'closure' ? 'bg-calendar-holiday' : '',
        !employed && 'bg-[repeating-linear-gradient(-45deg,transparent,transparent_6px,var(--calendar-grid)_6px,var(--calendar-grid)_7px)]',
      )}
      style={{ gridColumn: columnIndex + 2, gridRow: '1 / -1' }}
      title={description || undefined}
    >
      {row && day && state !== 'off' && (
        <span
          aria-hidden="true"
          className={cn('pointer-events-none absolute bottom-0.5 right-1 rounded-sm px-1 text-[11px] tabular-nums leading-4', CAPACITY_CLASS[state], compact && state !== 'overbooked' && state !== 'full' && 'hidden')}
        >
          {formatShortHours(plannedMinutes)}
          {compact ? '' : ` / ${formatShortHours(day.targetMinutes)}`}
        </span>
      )}
      {actual && actual.minutes > 0 && (
        <span
          aria-hidden="true"
          className={cn('pointer-events-none absolute bottom-0.5 left-1 rounded-sm px-1 text-[11px] tabular-nums leading-4', actual.pending ? 'bg-calendar-actual-pending text-calendar-actual-pending-foreground' : 'bg-calendar-actual text-calendar-actual-foreground')}
          title={actual.pending ? 'Ist-Zeit, Korrektur ausstehend' : 'Ist-Zeit'}
        >
          Ist {formatShortHours(actual.minutes)}
        </span>
      )}
      {canAdd && (
        <button
          type="button"
          className="absolute right-0.5 top-0.5 z-[1] rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/cell:opacity-100"
          aria-label={`Eintrag am ${dateLabel}${row ? ` für ${row.displayName}` : ''} anlegen`}
          onClick={() => actions.onAddEntry({ date: column.date, userId: row?.userId ?? undefined })}
        >
          <CalendarPlus className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
