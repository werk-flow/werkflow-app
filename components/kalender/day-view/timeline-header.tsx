'use client';

import { useEffect, useState } from 'react';
import { HOUR_WIDTH, TIMELINE_WIDTH } from './timeline-grid';

const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface TimelineHeaderProps {
  /** The date being displayed - current time indicator only shows if this is today */
  date?: Date;
}

export function TimelineHeader({ date }: TimelineHeaderProps) {
  const [currentTimePosition, setCurrentTimePosition] = useState<number | null>(
    null
  );

  // Check if the displayed date is today
  const isToday = date
    ? date.toDateString() === new Date().toDateString()
    : true;

  useEffect(() => {
    if (!isToday) {
      setCurrentTimePosition(null);
      return;
    }

    const updateCurrentTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const position = (hours + minutes / 60) * HOUR_WIDTH;
      setCurrentTimePosition(position);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
    return () => clearInterval(interval);
  }, [isToday]);

  // Calculate current time as percentage of day
  const currentTimePercent =
    currentTimePosition !== null
      ? (currentTimePosition / TIMELINE_WIDTH) * 100
      : null;

  return (
    <div className="relative h-10 border-b bg-muted/30 min-w-[1440px] w-full">
      {/* Hour markers - positioned as percentage to fill available width */}
      {HOURS.map((hour) => (
        <div
          key={hour}
          className="absolute top-0 h-full border-l border-border/50"
          style={{ left: `${(hour / 24) * 100}%` }}
        >
          <span className="absolute top-2 -translate-x-1/2 text-xs font-medium text-muted-foreground">
            {hour.toString().padStart(2, '0')}:00
          </span>
        </div>
      ))}

      {/* Current time indicator - only on today */}
      {isToday && currentTimePercent !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-destructive z-10"
          style={{ left: `${currentTimePercent}%` }}
        >
          <div className="absolute -top-0.5 -left-1 h-2 w-2 rounded-full bg-destructive" />
        </div>
      )}
    </div>
  );
}
