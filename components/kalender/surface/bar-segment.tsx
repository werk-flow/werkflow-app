'use client';

import { cn } from '@/lib/utils';
import type { BarEdge } from '@/lib/calendar/board-layout';

export type BarTone = 'absence' | 'absence-pending' | 'holiday' | 'closure' | 'note';

const TONE_CLASS: Record<BarTone, string> = {
  absence: 'bg-calendar-absence text-calendar-absence-foreground',
  'absence-pending': 'border border-dashed border-calendar-absence-pending-border bg-calendar-cell-off text-calendar-absence-foreground',
  holiday: 'bg-calendar-holiday text-calendar-holiday-foreground',
  closure: 'bg-calendar-holiday text-calendar-holiday-foreground',
  note: 'border border-dashed border-calendar-note-border bg-calendar-note text-calendar-note-foreground',
};

const EDGE_CLASS: Record<BarEdge, string> = {
  single: 'rounded-md',
  start: 'rounded-l-md',
  middle: '',
  end: 'rounded-r-md',
};

/**
 * One segment of a bar that may continue into the next cell (absences and
 * holidays in the month grid, multi-day occurrences split by hidden
 * weekends). Joined edges keep the eye reading one bar across cells.
 */
export function BarSegment({
  tone,
  edge,
  label,
  showLabel = true,
  className,
  title,
  startDate,
}: {
  tone: BarTone;
  edge: BarEdge;
  label: string;
  /** Only the first visible segment carries the label by default. */
  showLabel?: boolean;
  className?: string;
  title?: string;
  /** The bar's true first date, so a test can find one absence by its start. */
  startDate?: string | undefined;
}): React.JSX.Element {
  return (
    <div
      className={cn('flex h-5 min-w-0 items-center px-1.5 text-[11px] font-medium leading-none', TONE_CLASS[tone], EDGE_CLASS[edge], className)}
      title={title ?? label}
      data-calendar-bar={tone}
      data-bar-start={startDate}
    >
      {showLabel && <span className="truncate">{label}</span>}
    </div>
  );
}
