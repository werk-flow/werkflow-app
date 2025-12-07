'use client';

import { useEffect, useState } from 'react';

interface TimelineGridProps {
  /** Show the hour labels header */
  showHeader?: boolean;
  /** Children to render inside the timeline (e.g., work session blocks) */
  children?: React.ReactNode;
}

// Timeline configuration
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0-23
const HOUR_WIDTH = 60; // pixels per hour
const TIMELINE_WIDTH = HOURS.length * HOUR_WIDTH;

export function TimelineGrid({
  showHeader = false,
  children
}: TimelineGridProps) {
  const [currentTimePosition, setCurrentTimePosition] = useState<number | null>(
    null
  );

  // Calculate current time indicator position
  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const position = (hours + minutes / 60) * HOUR_WIDTH;
      setCurrentTimePosition(position);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  if (showHeader) {
    return (
      <div className="relative h-8" style={{ minWidth: TIMELINE_WIDTH }}>
        {/* Hour markers */}
        {HOURS.map((hour) => (
          <div
            key={hour}
            className="absolute top-0 h-full border-l border-border"
            style={{ left: hour * HOUR_WIDTH }}
          >
            <span className="absolute -top-0.5 -left-3 text-xs text-muted-foreground">
              {hour.toString().padStart(2, '0')}
            </span>
          </div>
        ))}
        {/* End marker */}
        <div
          className="absolute top-0 h-full border-l border-border"
          style={{ left: 24 * HOUR_WIDTH }}
        />
      </div>
    );
  }

  return (
    <div className="relative h-16" style={{ minWidth: TIMELINE_WIDTH }}>
      {/* Hour grid lines */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute top-0 h-full border-l border-border/50"
          style={{ left: hour * HOUR_WIDTH }}
        />
      ))}

      {/* Current time indicator */}
      {currentTimePosition !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-destructive z-10"
          style={{ left: currentTimePosition }}
        >
          <div className="absolute -top-1 -left-1 h-2 w-2 rounded-full bg-destructive" />
        </div>
      )}

      {/* Children (work session blocks) */}
      {children}
    </div>
  );
}

/**
 * Calculate the position and width for a time block
 */
export function calculateBlockPosition(
  startTime: Date,
  endTime: Date | null
): { left: number; width: number } {
  const startHours = startTime.getHours() + startTime.getMinutes() / 60;
  const left = startHours * HOUR_WIDTH;

  if (!endTime) {
    // Open session - extend to current time or end of day
    const now = new Date();
    const isToday = startTime.toDateString() === now.toDateString();
    const endHours = isToday ? now.getHours() + now.getMinutes() / 60 : 24;
    const width = Math.max((endHours - startHours) * HOUR_WIDTH, 10);
    return { left, width };
  }

  const endHours = endTime.getHours() + endTime.getMinutes() / 60;
  const width = Math.max((endHours - startHours) * HOUR_WIDTH, 10);

  return { left, width };
}

export { HOUR_WIDTH, TIMELINE_WIDTH };
