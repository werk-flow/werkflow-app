'use client';

import { memo, useMemo } from 'react';
import { BASE_HOUR_WIDTH } from './timeline-grid';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface TimelineHeaderProps {
  date?: Date;
  effectiveHourWidth?: number;
  timelineWidth?: number;
  currentTimePosition?: number | null;
}

export const TimelineHeader = memo(function TimelineHeader({
  date,
  effectiveHourWidth = BASE_HOUR_WIDTH,
  timelineWidth: totalWidth,
  currentTimePosition = null
}: TimelineHeaderProps) {
  const timelineWidth = totalWidth ?? 24 * effectiveHourWidth;

  const isToday = date
    ? date.toDateString() === new Date().toDateString()
    : true;
  // Determine which sub-labels to show based on zoom
  const subLabels = useMemo(() => {
    if (effectiveHourWidth >= 200) return [15, 30, 45];
    if (effectiveHourWidth >= 120) return [30];
    return [];
  }, [effectiveHourWidth]);

  // Opacity for sub-labels: fade in at threshold boundaries
  const subLabelOpacity = useMemo(() => {
    if (effectiveHourWidth >= 200) {
      const t = Math.min((effectiveHourWidth - 200) / 40, 1);
      return { half: 1, quarter: 0.5 + t * 0.5 };
    }
    if (effectiveHourWidth >= 120) {
      const t = Math.min((effectiveHourWidth - 120) / 40, 1);
      return { half: 0.5 + t * 0.5, quarter: 0 };
    }
    return { half: 0, quarter: 0 };
  }, [effectiveHourWidth]);

  return (
    <div
      className="relative h-10 border-b bg-muted/30"
      style={{ width: timelineWidth }}
    >
      {HOURS.map((hour) => (
        <div key={hour}>
          {/* Hour marker */}
          <div
            className="absolute top-0 h-full border-l border-border/50"
            style={{ left: hour * effectiveHourWidth }}
          >
            <span className="absolute top-2 -translate-x-1/2 text-xs font-medium text-muted-foreground whitespace-nowrap">
              {hour.toString().padStart(2, '0')}:00
            </span>
          </div>

          {/* Sub-labels */}
          {subLabels.map((minute) => {
            const offset = hour * effectiveHourWidth + (minute / 60) * effectiveHourWidth;
            const opacity = minute === 30 ? subLabelOpacity.half : subLabelOpacity.quarter;
            if (opacity <= 0) return null;
            return (
              <div
                key={`${hour}-${minute}`}
                className="absolute top-0 h-full border-l border-border/20"
                style={{ left: offset, opacity, transition: 'opacity 0.15s ease' }}
              >
                <span
                  className="absolute top-2.5 -translate-x-1/2 text-[10px] text-muted-foreground/60 whitespace-nowrap"
                  style={{ opacity, transition: 'opacity 0.15s ease' }}
                >
                  :{minute.toString().padStart(2, '0')}
                </span>
              </div>
            );
          })}
        </div>
      ))}

      {/* Current time indicator */}
      {isToday && currentTimePosition !== null && (
        <div
          className="absolute top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-destructive"
          style={{ left: currentTimePosition }}
        >
          <div className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-destructive" />
        </div>
      )}
    </div>
  );
});
