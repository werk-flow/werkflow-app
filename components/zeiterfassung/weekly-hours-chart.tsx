'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { computeTimeBreakdown } from '@/lib/time-tracking/helpers';
import type { DayData } from '@/hooks/use-weekly-time-data';

interface WeeklyHoursChartProps {
  weekData: DayData[];
  todayIndex: number;
  liveTodayMinutes?: number;
  narrowBars?: boolean;
  weekLabel?: { dateRange: string; kw: string };
  className?: string;
}

const GRID_HOURS = [2, 4, 6, 8, 10, 12];
const BAR_HEIGHT = 180;
const LABEL_AREA = 24;

export function WeeklyHoursChart({
  weekData,
  todayIndex,
  liveTodayMinutes,
  narrowBars = false,
  weekLabel,
  className
}: WeeklyHoursChartProps) {
  const data = useMemo(() => {
    if (!weekData.length) return [];
    return weekData.map((day, i) => {
      if (i === todayIndex && liveTodayMinutes !== undefined) {
        const bd = computeTimeBreakdown(liveTodayMinutes);
        return { ...day, ...bd, totalMinutes: liveTodayMinutes };
      }
      return day;
    });
  }, [weekData, todayIndex, liveTodayMinutes]);

  const maxMinutes = useMemo(() => {
    const tallest = Math.max(...data.map((d) => d.totalMinutes), 0);
    const ceil = Math.max(Math.ceil(tallest / 120) * 120, 480);
    return Math.min(ceil, 12 * 60);
  }, [data]);

  const gridLines = useMemo(
    () => GRID_HOURS.filter((h) => h * 60 <= maxMinutes),
    [maxMinutes]
  );

  if (!data.length) return null;

  // Helper: convert minutes to px offset from bottom of bar area
  const minutesToPx = (mins: number) => (mins / maxMinutes) * BAR_HEIGHT;

  return (
    <div className={cn('w-full', className)}>
      {weekLabel && (
        <div className="mb-6 flex items-baseline justify-between text-[11px] font-medium tabular-nums text-muted-foreground">
          <span>{weekLabel.dateRange}</span>
          <span>{weekLabel.kw}</span>
        </div>
      )}

      {/* Chart wrapper: position relative so all children use the same coordinate space.
          The bar area occupies the top BAR_HEIGHT px, the label area the bottom LABEL_AREA px. */}
      <div className="relative" style={{ height: BAR_HEIGHT + LABEL_AREA }}>
        {/* Y-axis labels – absolutely positioned from bottom, centered on the gridline.
           `bottom` sets the element's bottom edge, so translateY(50%) shifts it down
           by half its own height, placing its vertical center on the line. */}
        {gridLines.map((h) => (
          <span
            key={`label-${h}`}
            className="absolute left-0 z-20 translate-y-1/2 text-[10px] leading-none tabular-nums text-muted-foreground/60"
            style={{ bottom: LABEL_AREA + minutesToPx(h * 60) }}
          >
            {h}h
          </span>
        ))}

        {/* Horizontal grid lines – same coordinate system as labels */}
        {gridLines.map((h) => (
          <div
            key={`grid-${h}`}
            className="pointer-events-none absolute z-10 border-t border-dashed border-muted-foreground/15"
            style={{
              bottom: LABEL_AREA + minutesToPx(h * 60),
              left: 28,
              right: 0
            }}
          />
        ))}

        {/* Bar columns */}
        <div
          className="absolute flex items-end gap-1 sm:gap-1.5"
          style={{ top: 0, bottom: LABEL_AREA, left: 28, right: 0 }}
        >
          {data.map((day, i) => {
            const isToday = i === todayIndex;
            const workPx = minutesToPx(day.workMinutes);
            const breakPx = minutesToPx(day.breakMinutes);
            const overtimePx = minutesToPx(day.overtimeMinutes);

            return (
              <div
                key={day.date}
                className="flex h-full flex-1 flex-col items-center justify-end"
              >
                <div
                  className={cn(
                    'flex flex-col-reverse overflow-hidden rounded-t-[3px]',
                    narrowBars ? 'w-full max-w-[66px]' : 'w-[85%]',
                    isToday &&
                      'ring-1 ring-foreground/15 ring-offset-1 ring-offset-background'
                  )}
                  style={{ height: workPx + breakPx + overtimePx }}
                >
                  {workPx > 0 && (
                    <div
                      className="w-full shrink-0 bg-green-500 transition-all duration-500"
                      style={{ height: workPx }}
                    />
                  )}
                  {breakPx > 0 && (
                    <div
                      className="w-full shrink-0 bg-yellow-500 transition-all duration-500"
                      style={{ height: breakPx }}
                    />
                  )}
                  {overtimePx > 0 && (
                    <div
                      className="w-full shrink-0 bg-blue-500 transition-all duration-500"
                      style={{ height: overtimePx }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Day labels */}
        <div
          className="absolute flex gap-1 sm:gap-1.5"
          style={{ bottom: 0, height: LABEL_AREA, left: 28, right: 0 }}
        >
          {data.map((day, i) => {
            const isToday = i === todayIndex;
            return (
              <div
                key={`lbl-${day.date}`}
                className="flex flex-1 items-start justify-center pt-1.5"
              >
                <span
                  className={cn(
                    'text-[10px] tabular-nums leading-none',
                    isToday
                      ? 'font-semibold text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {day.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          Arbeitszeit
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
          Pause
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          Überstunden
        </span>
      </div>
    </div>
  );
}
