'use client';

import { cn } from '@/lib/utils';
import { CALENDAR_LAYER_CLASS } from './layers';

/**
 * The one now indicator (P1-24a, criterion 24): a 2 px line in
 * `--calendar-now` with an 8 px dot centred on it at the axis edge, drawn on
 * whole device pixels and never clipped by a header. Horizontal for the hour
 * axis of the day view, vertical for the board's today column and the
 * month's today cell.
 */
export function NowIndicator({
  orientation,
  offset,
  unit = 'px',
  className,
}: {
  orientation: 'vertical' | 'horizontal';
  /** Offset along the axis: whole pixels (rounded so line and dot share a pixel) or a percentage of the parent. */
  offset: number;
  unit?: 'px' | '%';
  className?: string;
}): React.JSX.Element {
  const position = unit === '%' ? `calc(${offset}% - 1px)` : Math.round(offset) - 1;
  return (
    <div
      aria-hidden="true"
      data-calendar-now=""
      className={cn('pointer-events-none absolute', CALENDAR_LAYER_CLASS.overlay, className)}
      style={orientation === 'vertical'
        ? { left: position, top: 0, bottom: 0, width: 2 }
        : { top: position, left: 0, right: 0, height: 2 }}
    >
      <div className="h-full w-full bg-calendar-now" />
      <div
        className="absolute size-2 rounded-full bg-calendar-now"
        style={orientation === 'vertical' ? { left: -3, top: -4 } : { top: -3, left: -4 }}
      />
    </div>
  );
}
