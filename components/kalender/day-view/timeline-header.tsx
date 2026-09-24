'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { DAY_NAME_COLUMN_PX } from '@/lib/calendar/day-layout';
import { CALENDAR_LAYER_CLASS } from '../surface/layers';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The hour axis of the day view; sub-labels appear as the zoom makes room. */
export const TimelineHeader = memo(function TimelineHeader({ hourWidth, label }: { hourWidth: number; label: string | null }) {
  const showHalves = hourWidth >= 120;
  const showQuarters = hourWidth >= 220;
  return (
    <div role="row" className={cn('sticky top-0 flex bg-background', CALENDAR_LAYER_CLASS.sticky)}>
      <div role="columnheader" className={cn('sticky left-0 flex shrink-0 items-end truncate border-b border-r border-calendar-grid-strong bg-calendar-gutter px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground', CALENDAR_LAYER_CLASS.sticky)} style={{ width: DAY_NAME_COLUMN_PX }} title={label ?? undefined}>
        {label ?? 'Mitarbeiter'}
      </div>
      <div role="columnheader" aria-label="Uhrzeit" className="relative h-9 shrink-0 border-b border-calendar-grid" style={{ width: 24 * hourWidth }}>
        {HOURS.map((hour) => (
          <div key={hour} className="absolute top-0 h-full border-l border-calendar-grid-strong" style={{ left: hour * hourWidth }}>
            <span className="absolute top-1.5 left-1 whitespace-nowrap text-xs font-medium tabular-nums text-muted-foreground">{String(hour).padStart(2, '0')}:00</span>
            {showHalves && <span className="absolute top-2.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/70" style={{ left: hourWidth / 2 + 2 }}>:30</span>}
            {showQuarters && (
              <>
                <span className="absolute top-2.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/60" style={{ left: hourWidth / 4 + 2 }}>:15</span>
                <span className="absolute top-2.5 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/60" style={{ left: (hourWidth * 3) / 4 + 2 }}>:45</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
